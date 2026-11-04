import asyncio
import json
import os

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")
os.environ.setdefault("IMAGE_PROVIDER", "mock")
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.assistant import Assistant, CallUsage  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import app  # noqa: E402
from app.marketing import ASO_LIMITS, aso, tidy_keywords  # noqa: E402
from app.schemas import AsoRequest  # noqa: E402

AUTH = {"X-Internal-Token": os.environ["INTERNAL_TOKEN"]}
client = TestClient(app)
FACTS = "Casalume is an AI interior design app. Tap one object in a room photo and change only that object."


def good(**over):
    data = {
        "app_name": "Casalume: AI Room Design", "app_subtitle": "Change one thing at a time",
        "app_keywords": "interior, decor ,decor,room,home makeover", "app_promo": "Tap a cushion, change it.",
        "app_description": "Desc.", "app_whats_new": "Fixes.", "play_title": "Casalume: AI Room Design",
        "play_short": "Tap one object in your room photo and change only that.", "play_description": "Long.",
    }
    data.update(over)
    return json.dumps(data)


class FakeAssistant(Assistant):
    """Answers from a script instead of Claude, recording what it was asked."""

    def __init__(self, answers):
        super().__init__(Settings(INTERNAL_TOKEN=os.environ["INTERNAL_TOKEN"], IMAGE_PROVIDER="mock"))
        self.client = object()
        self.answers = list(answers)
        self.calls = []

    async def _call(self, *, system, messages, effort, schema):
        self.calls.append({"system": system, "messages": messages, "effort": effort})
        return self.answers.pop(0), CallUsage(model="claude-opus-5-5", input_tokens=1000, output_tokens=500, latency_ms=10)


def test_demo_listing_needs_the_token_and_reports_usage():
    body = {"locale": "de", "facts": FACTS}
    assert client.post("/internal/v1/marketing/aso", json=body).status_code == 401
    res = client.post("/internal/v1/marketing/aso", headers=AUTH, json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["violations"] == [] and out["usage"]["kind"] == "marketing"
    assert set(out["listing"]) == set(ASO_LIMITS)


def test_request_is_bounded():
    assert client.post("/internal/v1/marketing/aso", headers=AUTH, json={"locale": "de", "facts": "short"}).status_code == 400
    assert client.post("/internal/v1/marketing/aso", headers=AUTH, json={"locale": "pt", "facts": FACTS}).status_code == 400
    long_brief = {"locale": "en", "facts": FACTS, "brief": "x" * 1001}
    assert client.post("/internal/v1/marketing/aso", headers=AUTH, json=long_brief).status_code == 400


def test_keywords_are_tidied_for_apple():
    assert tidy_keywords("interior, decor ,Decor,room,casalume,ai", "Casalume: AI Room", "Design") == "interior,decor"
    assert tidy_keywords("インテリア、家具，部屋", "Casalume", "") == "インテリア,家具,部屋"


def test_over_long_fields_are_rewritten_once():
    fake = FakeAssistant([good(play_short="x" * 95, app_subtitle="y" * 40), good(play_short="Short enough.", app_subtitle="Fits now", app_promo="changed")])
    out = asyncio.run(aso(fake, AsoRequest(locale="en", facts=FACTS, brief="Focus on small flats")))
    assert len(fake.calls) == 2 and fake.calls[1]["effort"] == "low"
    assert "play_short is 95/80" in fake.calls[1]["messages"][-1]["content"]
    # Only the broken fields come from the rewrite; the rest of the first answer stays.
    assert out.listing.play_short == "Short enough." and out.listing.app_subtitle == "Fits now"
    assert out.listing.app_promo == "Tap a cushion, change it."
    assert out.listing.app_keywords == "interior,decor,home makeover"
    assert out.violations == []
    assert out.usage.input_tokens == 2000 and out.usage.cost_usd > 0
    assert "<OWNER NOTES>\nFocus on small flats" in fake.calls[0]["messages"][0]["content"]


def test_a_field_still_too_long_is_reported_not_cut():
    fake = FakeAssistant([good(play_title="z" * 31), good(play_title="z" * 33)])
    out = asyncio.run(aso(fake, AsoRequest(locale="ja", facts=FACTS)))
    assert out.violations == ["play_title"] and len(out.listing.play_title) == 33
    assert "Japanese" in fake.calls[0]["messages"][0]["content"] and "です/ます" in fake.calls[0]["system"]


def post(**over):
    data = {"title": "Japandi living room", "caption": "Same room, redesigned with AI.",
            "hashtags": ["#interior design", "japandi", "Japandi", "#casalume", "decor", "home", "calm"],
            "alt_text": "A living room before and after."}
    data.update(over)
    return json.dumps(data)


def test_social_demo_and_bounds():
    body = {"locale": "tr", "platform": "instagram", "style_name": "Japandi", "facts": FACTS}
    res = client.post("/internal/v1/marketing/social", headers=AUTH, json=body)
    assert res.status_code == 200, res.text
    assert res.json()["post"]["caption"].startswith("[Demo]") and res.json()["usage"]["kind"] == "marketing"
    assert client.post("/internal/v1/marketing/social", headers=AUTH, json={**body, "platform": "facebook"}).status_code == 400


def test_social_hashtags_are_cleaned_and_capped():
    from app.marketing import social
    from app.schemas import SocialRequest

    fake = FakeAssistant([post()])
    out = asyncio.run(social(fake, SocialRequest(locale="de", platform="instagram", style_name="Japandi", facts=FACTS, brief="Ruhig")))
    assert out.post.hashtags == ["interiordesign", "japandi", "casalume", "decor", "home"]
    assert out.violations == []
    assert "German" in fake.calls[0]["system"] and "informal 'du'" in fake.calls[0]["system"]
    assert "<OWNER NOTES>\nRuhig" in fake.calls[0]["messages"][0]["content"]


def test_pinterest_caption_limit_is_reported():
    from app.marketing import social
    from app.schemas import SocialRequest

    fake = FakeAssistant([post(caption="x" * 501)])
    out = asyncio.run(social(fake, SocialRequest(locale="en", platform="pinterest", style_name="Aegean", facts=FACTS)))
    assert out.violations == ["caption"] and len(out.post.caption) == 501


def test_campaign_link_must_be_offered_and_limits_reported():
    from app.marketing import campaign
    from app.schemas import CampaignRequest

    fake = FakeAssistant([json.dumps({"title": "Yeni stiller", "body": "x" * 301, "link": "https://evil.example"})])
    out = asyncio.run(campaign(fake, CampaignRequest(locale="tr", channel="PUSH", kind="SERVICE", goal="Yeni stilleri duyur", facts=FACTS, links=["/studio"])))
    assert out.message.link is None and out.violations == ["body"]
    assert "NOT a commercial message" in fake.calls[0]["system"] and "<GOAL>\nYeni stilleri duyur" in fake.calls[0]["messages"][0]["content"]


def test_campaign_and_report_demo():
    body = {"locale": "en", "channel": "EMAIL", "kind": "MARKETING", "goal": "Invite to try PRO", "facts": FACTS, "links": ["/studio"]}
    res = client.post("/internal/v1/marketing/campaign", headers=AUTH, json=body)
    assert res.status_code == 200 and res.json()["message"]["link"] == "/studio"
    rep = client.post("/internal/v1/marketing/report", headers=AUTH, json={"metrics": json.dumps({"users": {"new": 3}})})
    assert rep.status_code == 200 and rep.json()["report"]["summary"].startswith("[Demo]")


def test_blog_slug_and_limits():
    from app.marketing import blog, slugify
    from app.schemas import BlogRequest

    assert slugify("Küçük Salon Dekorasyonu: 7 İpucu") == "kucuk-salon-dekorasyonu-7-ipucu"
    fake = FakeAssistant([json.dumps({"title": "小さなリビング", "description": "d" * 170, "slug": "Small Living Room!", "body": "## A\n\ntext"})])
    out = asyncio.run(blog(fake, BlogRequest(locale="ja", facts=FACTS, topic="Small living room", links=["/studio"])))
    assert out.article.slug == "small-living-room" and out.violations == ["description"]
    assert "Japanese" in fake.calls[0]["system"] and "<TOPIC>\nSmall living room" in fake.calls[0]["messages"][0]["content"]
    assert client.post("/internal/v1/marketing/blog", headers=AUTH, json={"locale": "tr", "facts": FACTS}).status_code == 400


def test_blog_translation_uses_the_source():
    from app.marketing import blog
    from app.schemas import BlogRequest, BlogSource

    fake = FakeAssistant([json.dumps({"title": "Kleines Wohnzimmer", "description": "x" * 140, "slug": "kleines-wohnzimmer", "body": "## A"})])
    src = BlogSource(title="Küçük salon", description="Açıklama", body="## Başlık\n\nMetin [stüdyo](/studio)")
    out = asyncio.run(blog(fake, BlogRequest(locale="de", facts=FACTS, source=src, links=["/studio"])))
    assert out.violations == [] and fake.calls[0]["effort"] == "low"
    assert "<SOURCE>\n# Küçük salon" in fake.calls[0]["messages"][0]["content"] and "localize" in fake.calls[0]["system"]


def test_seo_keeps_only_requested_keys():
    from app.marketing import seo
    from app.schemas import SeoPage, SeoRequest

    answer = {"pages": [{"key": "home", "title": "Casalume: AI oda tasarımı", "description": "d" * 130},
                        {"key": "evil", "title": "x", "description": "y"},
                        {"key": "studio", "title": "t" * 61, "description": "d" * 130}]}
    fake = FakeAssistant([json.dumps(answer)])
    pages = [SeoPage(key="home", path="/", purpose="Landing"), SeoPage(key="studio", path="/studio", purpose="Studio"),
             SeoPage(key="chat", path="/sohbet", purpose="Chat")]
    out = asyncio.run(seo(fake, SeoRequest(locale="tr", facts=FACTS, pages=pages)))
    assert [p.key for p in out.pages] == ["home", "studio"]
    assert out.violations == ["studio.title", "chat.missing"]
