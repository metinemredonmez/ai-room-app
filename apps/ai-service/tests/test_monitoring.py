import json

from app.monitoring import mask_text, scrub_breadcrumb, scrub_event


def test_masks_personal_data_and_secrets_in_text():
    s = mask_text(
        "ayse@example.com Bearer abcdefghijk Key fal_key_abcdefgh:12345678 sk-ant-api03-SECRETSECRET "
        "https://fal.media/x.png?token=T0K 10.0.0.7 data:image/png;base64,AAAA " + "Q" * 200
    )
    for leak in ["ayse@example.com", "abcdefghijk", "fal_key_abcdefgh", "SECRETSECRET", "T0K", "10.0.0.7", "base64,AAAA", "Q" * 100]:
        assert leak not in s
    assert len(mask_text("x" * 5000)) < 1100


def test_event_keeps_no_body_headers_user_or_local_variables():
    event = {
        "user": {"ip_address": "1.2.3.4"},
        "request": {
            "method": "POST", "url": "http://ai:8001/generate?sig=abc", "query_string": "sig=abc",
            "data": {"image": "AAAA", "prompt": "my room"}, "cookies": {"s": "1"},
            "headers": {"X-Internal-Token": "internal-secret", "User-Agent": "backend", "X-Forwarded-For": "1.2.3.4"},
        },
        "logentry": {"message": '{"event":"unhandled","request_id":"%s"}', "params": ["r1"]},
        "exception": {"values": [{"type": "KeyError", "value": "'ayse@example.com'",
                                  "stacktrace": {"frames": [{"function": "generate", "vars": {"settings": "INTERNAL_TOKEN=x"}}]}}]},
        "breadcrumbs": {"values": [{"category": "ai-service", "message": '{"event":"request","path":"/generate","user":"u1"}'}]},
        "extra": {"prompt": "my room", "note": "call 10.1.1.1"},
    }
    out = json.dumps(scrub_event(event))
    for leak in ["1.2.3.4", "sig=abc", "AAAA", "my room", "internal-secret", "ayse@", "INTERNAL_TOKEN", "u1", "10.1.1.1", '"s": "1"']:
        assert leak not in out
    assert "backend" in out and "r1" in out and "unhandled" in out and '"message": "request"' in out


def test_http_breadcrumb_keeps_only_method_status_and_bare_url():
    crumb = scrub_breadcrumb({"category": "httplib", "data": {"method": "POST", "url": "https://fal.run/x?key=K", "status_code": 500, "body": "b"}})
    assert crumb["data"] == {"method": "POST", "status_code": 500, "url": "https://fal.run/x"}
