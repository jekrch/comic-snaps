"""restore_judge.py: the guidance it reads, and the checks on what the model asks for."""
import json

import pytest

import restore_judge as rj


@pytest.mark.parametrize("skill", ["restore-bw-panel", "restore-color-panel"])
def test_the_rubric_is_read_from_each_skill(skill):
    text = rj.rubric(skill)
    assert text.startswith("### 4.")
    assert "## What its warnings mean" in text and "## Skip it" in text
    # Installing and the internals aren't the judge's business.
    assert "### 5." not in text and "## How it works" not in text


def test_the_schema_offers_every_flag():
    names = rj.JUDGE_SCHEMA["properties"]["flags"]["items"]["properties"]["name"]["enum"]
    assert set(names) == {n for flags in rj.FLAGS.values() for n in flags}


def test_boxes():
    assert rj.parse_box("100,200,300,400") == (100, 200, 300, 400)
    assert rj.parse_box("[100, 200, 300, 400]") == (100, 200, 300, 400)
    for bad in ("1,2,3", "300,0,100,500", "0,0,1001,10", "a,b,c,d"):
        with pytest.raises(ValueError):
            rj.parse_box(bad)
    # 0-1000 over an 800x1200 image; never off the edge, never under 4 px.
    assert rj.box_pixels((100, 200, 300, 400), 800, 1200) == (160, 120, 160, 240)
    assert rj.box_pixels((999, 999, 1000, 1000), 800, 1200) == (796, 1196, 4, 4)


def test_flags_are_checked_and_written_with_equals():
    argv, shown = rj.build_flags("color", [
        {"name": "ink-sigmas", "value": "-1.5"},
        {"name": "keep-dark-hue", "value": "true"},
        {"name": "no-balance", "value": "false"},
        {"name": "white-box", "value": "0,0,100,500"},
        {"name": "white-box", "value": "500,500,600,600"},
        {"name": "tint", "value": "0,0"},
    ], (1000, 2000))
    # A negative value needs the = form, or argparse reads it as an option.
    assert argv == ["--ink-sigmas=-1.5", "--keep-dark-hue", "--white-box=0,0,500,200",
                    "--white-box=500,1000,100,200", "--tint=0,0"]
    assert shown == " ".join(argv)
    assert rj.build_flags("bw", [], (800, 1200)) == ([], "defaults")


@pytest.mark.parametrize("script, flags", [
    ("bw", [{"name": "strength", "value": "0.5"}]),  # A color-only flag.
    ("bw", [{"name": "top", "value": "0,40"}]),  # Reframes; never offered.
    ("bw", [{"name": "gamma", "value": "4"}]),  # Out of range.
    ("bw", [{"name": "gamma", "value": "lots"}]),
    ("bw", [{"name": "gamma", "value": "0.8"}, {"name": "gamma", "value": "0.9"}]),
    ("color", [{"name": "saturation", "value": "1.5"}]),
    ("color", [{"name": "white-box", "value": "0,0,10,10"}] * 7),
])
def test_bad_flags_are_refused(script, flags):
    with pytest.raises(ValueError):
        rj.build_flags(script, flags, (800, 1200))


def test_reply_parsing_skips_thoughts_and_fences():
    body = {"candidates": [{"content": {"parts": [
        {"text": "thinking about it", "thought": True},
        {"text": '```json\n{"decision": "skip", "notes": "n"}\n```'},
    ]}}]}
    value, _ = rj.response_json(body)
    assert value == {"decision": "skip", "notes": "n"}
    with pytest.raises(ValueError):
        rj.response_json({"candidates": [], "promptFeedback": {"blockReason": "OTHER"}})


def test_a_whole_run_against_a_scripted_model(tmp_path, monkeypatch):
    """Runs the real bw script; the model is replaced by fixed replies."""
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")

    # A small grey page with black ink: enough for the bw script to work on.
    page = np.full((400, 300, 3), 205, np.uint8)
    page[:, :, 0] = 190  # A warm cast.
    cv2.rectangle(page, (40, 60), (260, 120), (20, 20, 20), -1)
    cv2.putText(page, "POW", (60, 300), cv2.FONT_HERSHEY_SIMPLEX, 2, (25, 25, 25), 5)
    source = tmp_path / "source.jpg"
    cv2.imwrite(str(source), page)

    replies = iter([
        {"decision": "retry", "flags": [{"name": "ink-sigmas", "value": "3"}],
         "zoom": ["100,100,400,900"], "probe": ["0,0,100,100", "bad"], "notes": "blacks mottled"},
        {"decision": "retry", "flags": [{"name": "ink-sigmas", "value": "3"}], "zoom": ["600,100,900,900"],
         "notes": "look at the lettering"},
        {"decision": "install", "install_round": 2, "notes": "round 2", "summary": "Blacks are solid now."},
    ])
    seen = []

    def fake_call(model, key, system, contents, schema, usage):
        seen.append(contents[-1])
        reply = next(replies)
        return reply, json.dumps(reply)

    monkeypatch.setattr(rj, "call_model", fake_call)
    decision = rj.judge(source, "bw", "Test #1", tmp_path / "work", "fake", "key")

    assert decision == "install"
    out = tmp_path / "work" / "out"
    assert (out / "restored.jpg").read_bytes() == (tmp_path / "work" / "round2.jpg").read_bytes()
    summary = (out / "summary.txt").read_text()
    assert summary.startswith("restore-bw-panel, --ink-sigmas=3 (round 2 of 2 run).")
    assert "Blacks are solid now." in summary

    texts = ["\n".join(p["text"] for p in c["parts"] if "text" in p) for c in seen]
    images = [sum("inlineData" in p for p in c["parts"]) for c in seen]
    assert images == [2, 1, 1]  # Source and result, then one zoom pair each.
    assert "ran the bw script with defaults" in texts[0]
    assert "with --ink-sigmas=3" in texts[1] and "Probe" in texts[1] and "probe: box 'bad'" in texts[1]
    assert "nothing was rerun" in texts[2]
