import json

import pytest

import metadata.publishers as publishers
from metadata.publishers import (
    KIND_IMPRINT,
    Registry,
    apply_comicvine_detail,
    apply_gcd_detail,
    apply_metron_detail,
    apply_source_publisher,
    backfill_publishers,
    country_name,
    link_series,
    name_key,
)


def entry(entry_id, name, kind="publisher", parent=None, aliases=None, ids=None):
    return {
        "id": entry_id, "name": name, "kind": kind, "parent": parent,
        "aliases": aliases or [], "description": "", "imageUrl": None,
        "references": [], "ids": ids or {},
    }


@pytest.fixture
def reg():
    return Registry([
        entry("image-comics", "Image Comics", aliases=["Image"]),
        entry("dc-comics", "DC Comics", aliases=["DC"]),
        entry("kitchen-sink-press", "Kitchen Sink Press", aliases=["Kitchen Sink"]),
        entry("oni-press", "Oni Press"),
        entry("skybound", "Skybound", kind=KIND_IMPRINT, parent="image-comics"),
        entry("vertigo", "Vertigo", kind=KIND_IMPRINT, parent="dc-comics"),
    ])


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(publishers.time, "sleep", lambda s: None)


class TestNameKey:
    @pytest.mark.parametrize("a, b", [
        ("Image", "Image Comics"),
        ("Kitchen Sink", "Kitchen Sink Press"),
        ("Boom! Studios", "BOOM!"),
        ("The Print Mint", "Print Mint"),
        ("Food Chain (self-published)", "Food Chain"),
        ("Drawn & Quarterly", "Drawn and Quarterly"),
        ("Deadline Publications Ltd.", "Deadline"),
    ])
    def test_spellings_of_one_company_share_a_key(self, a, b):
        assert name_key(a) == name_key(b)

    def test_different_companies_do_not(self):
        assert name_key("Dark Horse Comics") != name_key("DC Comics")

    def test_a_name_made_only_of_corporate_words_keeps_one(self):
        # Trailing words are stripped only while another word remains.
        assert name_key("Comics Press") == "comics"


class TestResolve:
    def test_exact_name(self, reg):
        assert reg.resolve("Oni Press")["id"] == "oni-press"

    def test_alias_case_insensitively(self, reg):
        assert reg.resolve("kitchen sink")["id"] == "kitchen-sink-press"

    def test_loose_key(self, reg):
        assert reg.resolve("Image Comics, Inc.")["id"] == "image-comics"

    def test_unknown(self, reg):
        assert reg.resolve("Fantagraphics") is None

    def test_a_key_two_entries_share_is_no_match(self):
        r = Registry([entry("a", "Tundra Publishing"), entry("b", "Tundra Comics")])
        assert r.resolve("Tundra") is None

    def test_an_exact_name_beats_a_shared_key(self):
        r = Registry([entry("a", "Tundra Publishing"), entry("b", "Tundra Comics")])
        assert r.resolve("Tundra Comics")["id"] == "b"

    def test_metron_ids_are_kept_apart_by_kind(self, reg):
        reg.get("image-comics")["ids"]["metron"] = 7
        reg.get("vertigo")["ids"]["metron"] = 7
        assert reg.by_source_id("metron", 7, imprint=False)["id"] == "image-comics"
        assert reg.by_source_id("metron", 7, imprint=True)["id"] == "vertigo"


class TestLinkSeries:
    def test_an_alias_is_rewritten_to_the_canonical_name(self, reg):
        s = {"id": "x", "publisher": "Image", "issueCount": 3}
        assert link_series(s, reg)
        assert s["publisher"] == "Image Comics"
        assert s["publisherId"] == "image-comics"

    def test_ids_are_placed_right_after_the_publisher(self, reg):
        s = {"id": "x", "startYear": 1, "publisher": "Image", "issueCount": 3}
        link_series(s, reg)
        assert list(s) == ["id", "startYear", "publisher", "publisherId", "issueCount"]

    def test_an_imprint_string_files_under_its_parent(self, reg):
        s = {"id": "x", "publisher": "Skybound"}
        link_series(s, reg)
        assert (s["publisher"], s["publisherId"]) == ("Image Comics", "image-comics")
        assert (s["imprint"], s["imprintId"]) == ("Skybound", "skybound")

    def test_a_hand_set_imprint_is_kept(self, reg):
        s = {"id": "x", "publisher": "DC Comics", "imprintId": "vertigo"}
        link_series(s, reg)
        assert s["imprint"] == "Vertigo"

    def test_is_idempotent(self, reg):
        s = {"id": "x", "publisher": "Skybound"}
        link_series(s, reg)
        assert not link_series(s, reg)

    def test_a_hand_edited_string_wins_over_the_ids(self, reg):
        s = {"id": "x", "publisher": "Oni Press", "publisherId": "image-comics",
             "imprintId": "skybound", "imprint": "Skybound"}
        link_series(s, reg)
        assert s["publisherId"] == "oni-press"
        assert "imprintId" not in s and "imprint" not in s

    def test_an_unknown_name_gets_a_new_entry(self, reg):
        s = {"id": "x", "publisher": "Silver Sprocket"}
        link_series(s, reg)
        assert s["publisherId"] == "silver-sprocket"
        assert reg.get("silver-sprocket")["kind"] == "publisher"

    def test_a_url_in_the_publisher_field_is_cleared(self, reg):
        s = {"id": "x", "publisher": "https://www.comics.org/api/publisher/54/?format=json"}
        link_series(s, reg)
        assert s["publisher"] is None
        assert "publisherId" not in s

    def test_no_publisher_leaves_the_series_alone(self, reg):
        s = {"id": "x", "publisher": None}
        assert not link_series(s, reg)

    def test_an_entry_later_refiled_as_an_imprint_moves_the_series(self, reg):
        reg.entries.append(entry("icon", "Icon", kind=KIND_IMPRINT, parent="oni-press"))
        # The string still carries the entry's own name from when a source
        # first filed it as a publisher.
        s = {"id": "x", "publisher": "Icon", "publisherId": "icon"}
        link_series(s, reg)
        assert (s["publisherId"], s["imprintId"]) == ("oni-press", "icon")
        assert (s["publisher"], s["imprint"]) == ("Oni Press", "Icon")


class TestApplySourcePublisher:
    def test_fills_a_missing_publisher_and_records_the_id(self, reg):
        s = {"id": "x", "publisher": None}
        assert apply_source_publisher(s, reg, "metron", 1, "Image")
        assert s["publisherId"] == "image-comics"
        assert reg.get("image-comics")["ids"] == {"metron": 1}

    def test_attaches_the_id_when_the_source_agrees(self, reg):
        s = {"id": "x", "publisher": "Image Comics", "publisherId": "image-comics"}
        apply_source_publisher(s, reg, "comicvine", 513, "Image")
        assert reg.get("image-comics")["ids"]["comicvine"] == 513

    def test_a_disagreeing_source_changes_nothing(self, reg):
        # Archie's 2026 titles are Oni Press by hand; a source saying
        # "Archie Comics" must not move the series or tag Oni with Archie's id.
        s = {"id": "x", "publisher": "Oni Press", "publisherId": "oni-press"}
        assert not apply_source_publisher(s, reg, "metron", 99, "Archie Comic Publications")
        assert s["publisherId"] == "oni-press"
        assert reg.get("oni-press")["ids"] == {}
        assert reg.resolve("Archie Comic Publications") is None

    def test_a_known_but_different_publisher_changes_nothing(self, reg):
        s = {"id": "x", "publisher": "Oni Press", "publisherId": "oni-press"}
        assert not apply_source_publisher(s, reg, "comicvine", 5, "DC Comics")
        assert reg.get("dc-comics")["ids"] == {}

    def test_a_source_naming_an_imprint_files_the_series_under_it(self, reg):
        # Comic Vine lists Vertigo as the publisher of Vertigo titles.
        s = {"id": "x", "publisher": "DC Comics", "publisherId": "dc-comics"}
        assert apply_source_publisher(s, reg, "comicvine", 521, "Vertigo")
        assert (s["publisherId"], s["imprintId"]) == ("dc-comics", "vertigo")
        assert reg.get("vertigo")["ids"]["comicvine"] == 521

    def test_a_metron_imprint_is_created_under_the_agreeing_publisher(self, reg):
        s = {"id": "x", "publisher": "Image Comics", "publisherId": "image-comics"}
        assert apply_source_publisher(s, reg, "metron", 1, "Image", 40, "Ghost Machine")
        ghost = reg.get("ghost-machine")
        assert (ghost["kind"], ghost["parent"], ghost["ids"]) == (KIND_IMPRINT, "image-comics", {"metron": 40})
        assert s["imprint"] == "Ghost Machine"

    def test_a_metron_imprint_is_ignored_when_its_publisher_disagrees(self, reg):
        s = {"id": "x", "publisher": "Oni Press", "publisherId": "oni-press"}
        apply_source_publisher(s, reg, "metron", 1, "Image", 40, "Ghost Machine")
        assert reg.get("ghost-machine") is None
        assert "imprintId" not in s

    def test_metron_refiles_a_publisher_entry_as_an_imprint(self, reg):
        reg.entries.append(entry("top-cow", "Top Cow"))
        s = {"id": "x", "publisher": "Image Comics", "publisherId": "image-comics"}
        apply_source_publisher(s, reg, "metron", 1, "Image", 3, "Top Cow")
        assert reg.get("top-cow")["kind"] == KIND_IMPRINT
        assert reg.get("top-cow")["parent"] == "image-comics"
        assert s["imprintId"] == "top-cow"

    def test_a_hand_set_imprint_is_not_replaced(self, reg):
        s = {"id": "x", "publisher": "Image Comics", "publisherId": "image-comics",
             "imprintId": "skybound", "imprint": "Skybound"}
        apply_source_publisher(s, reg, "metron", 1, "Image", 40, "Ghost Machine")
        assert s["imprintId"] == "skybound"

    def test_an_existing_different_id_is_not_overwritten(self, reg):
        reg.get("image-comics")["ids"]["metron"] = 1
        s = {"id": "x", "publisher": "Image Comics", "publisherId": "image-comics"}
        apply_source_publisher(s, reg, "metron", 2, "Image")
        assert reg.get("image-comics")["ids"]["metron"] == 1


class TestDetail:
    def test_metron_fills_fields_and_cross_ids(self, reg):
        e = reg.get("image-comics")
        apply_metron_detail(e, reg, {
            "desc": "Image Comics is an American comic book publisher founded in 1992.",
            "image": "https://static.metron.cloud/image.jpg",
            "founded": 1992, "country": "US", "alt_names": ["Image Comics Inc."],
            "cv_id": 513, "gcd_id": 709,
            "resource_url": "https://metron.cloud/publisher/image/",
        })
        assert e["foundedYear"] == 1992
        assert e["country"] == "United States"
        assert e["ids"] == {"comicvine": 513, "gcd": 709}
        assert "Image Comics Inc." in e["aliases"]
        assert e["references"] == [{"name": "Metron", "url": "https://metron.cloud/publisher/image/"}]

    def test_metron_fills_an_imprint_parent(self, reg):
        imp = entry("ghost", "Ghost Machine", kind=KIND_IMPRINT)
        reg.entries.append(imp)
        reg.get("image-comics")["ids"]["metron"] = 1
        apply_metron_detail(imp, reg, {"desc": "", "publisher": {"id": 1, "name": "Image"}})
        assert imp["parent"] == "image-comics"

    def test_a_description_already_written_is_kept(self, reg):
        e = reg.get("oni-press")
        e["description"] = "Oni Press is an American independent comic book publisher in Portland."
        apply_metron_detail(e, reg, {"desc": "Something else entirely, long enough to count here."})
        assert e["description"].startswith("Oni Press")

    def test_comic_vine_location_and_aliases(self, reg):
        e = reg.get("oni-press")
        apply_comicvine_detail(e, reg, {
            "location_city": "Portland", "location_state": "Oregon",
            "aliases": "Oni\nOni Press\n", "site_detail_url": "https://comicvine.gamespot.com/oni-press/4010-1/",
            "image": {"super_url": "https://comicvine.gamespot.com/a/uploads/1-blank.png"},
        })
        assert e["location"] == "Portland, Oregon"
        assert e["aliases"] == ["Oni"]
        assert e["imageUrl"] is None  # Comic Vine's placeholder isn't an image

    def test_gcd_years_and_website(self, reg):
        e = reg.get("kitchen-sink-press")
        apply_gcd_detail(e, 55, {"year_began": 1969, "year_ended": 1999, "country": "us",
                                 "url": "http://kitchensink.example/", "notes": ""})
        # GCD's span of books, kept apart from a founding year.
        assert (e["activeFrom"], e["activeUntil"]) == (1969, 1999)
        assert "foundedYear" not in e
        assert e["website"] == "http://kitchensink.example/"
        assert e["references"][0]["url"] == "https://www.comics.org/publisher/55/"

    def test_gcd_years_it_marks_uncertain_are_skipped(self, reg):
        e = reg.get("oni-press")
        apply_gcd_detail(e, 9, {"year_began": 1997, "year_began_uncertain": True,
                                "year_ended": None, "notes": ""})
        assert "activeFrom" not in e

    def test_country_codes(self):
        assert country_name("gb") == "United Kingdom"
        assert country_name("zz") is None
        assert country_name(None) is None


class TestBackfill:
    @pytest.fixture
    def files(self, tmp_path, monkeypatch):
        monkeypatch.setattr(publishers, "backfill_wikipedia_descriptions", lambda p, k: 0)
        series = tmp_path / "series.json"
        pubs = tmp_path / "publishers.json"
        series.write_text(json.dumps({"series": [
            {"id": "a", "name": "A", "publisher": "Image",
             "references": [{"name": "Metron", "url": "https://metron.cloud/series/10/"}]},
            {"id": "b", "name": "B", "publisher": None,
             "references": [{"name": "Comic Vine", "url": "https://comicvine.gamespot.com/b/4050-20/"}]},
        ]}, indent=2) + "\n")
        pubs.write_text(json.dumps({"publishers": [entry("image-comics", "Image Comics", aliases=["Image"])]}))
        return series, pubs

    def test_offline_it_only_links(self, files):
        series, pubs = files
        backfill_publishers(series, pubs, metron_creds=None, comic_vine_key=None, skip_gcd=True)
        s = json.loads(series.read_text())["series"]
        assert s[0]["publisherId"] == "image-comics"
        assert "publisherId" not in s[1]

    def test_online_it_links_imprints_and_enriches(self, files, monkeypatch):
        series, pubs = files
        metron_calls = []

        def fake_metron(endpoint, params, user, pw, health=None):
            metron_calls.append(endpoint)
            return {
                "series/10/": {"publisher": {"id": 1, "name": "Image"},
                               "imprint": {"id": 4, "name": "Skybound"}},
                "publisher/1/": {"desc": "", "founded": 1992, "cv_id": 513, "gcd_id": None,
                                 "resource_url": "https://metron.cloud/publisher/image/"},
                "imprint/4/": {"desc": "", "founded": 2010,
                               "resource_url": "https://metron.cloud/imprint/skybound/"},
            }.get(endpoint)

        def fake_cv(path, params, key, health=None):
            return {
                "volume/4050-20/": {"results": {"publisher": {"id": 77, "name": "Silver Sprocket"}}},
                "publisher/4010-77/": {"results": {"location_city": "San Francisco",
                                                   "location_state": "California"}},
                "publisher/4010-513/": {"results": {}},
            }.get(path)

        monkeypatch.setattr(publishers, "metron_get", fake_metron)
        monkeypatch.setattr(publishers, "comic_vine_get", fake_cv)
        backfill_publishers(series, pubs, metron_creds=("u", "p"), comic_vine_key="k", skip_gcd=True)

        s = {x["id"]: x for x in json.loads(series.read_text())["series"]}
        reg = Registry.load(pubs)
        assert (s["a"]["publisherId"], s["a"]["imprintId"]) == ("image-comics", "skybound")
        assert reg.get("skybound")["foundedYear"] == 2010
        assert reg.get("image-comics")["ids"] == {"metron": 1, "comicvine": 513}
        assert s["b"]["publisher"] == "Silver Sprocket"
        assert reg.get("silver-sprocket")["location"] == "San Francisco, California"
        assert "metron-publisher" in s["a"]["sources"]

        # A second run has nothing left to ask Metron.
        metron_calls.clear()
        backfill_publishers(series, pubs, metron_creds=("u", "p"), comic_vine_key="k", skip_gcd=True)
        assert metron_calls == []

    def test_a_failed_lookup_is_retried_next_run(self, files, monkeypatch):
        series, pubs = files
        monkeypatch.setattr(publishers, "metron_get", lambda *a, **k: None)
        backfill_publishers(series, pubs, metron_creds=("u", "p"), comic_vine_key=None, skip_gcd=True)
        s = json.loads(series.read_text())["series"]
        assert "metron-publisher" not in (s[0].get("sources") or [])
