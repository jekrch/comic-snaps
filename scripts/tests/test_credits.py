import pytest

from metadata.credits import (
    ROLE_ORDER,
    get_gallery_issue_pairs,
    merge_credit,
    normalize_role,
    promote_creators,
    role_rank,
    sort_credits,
)


class TestNormalizeRole:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("writer", "Writer"),
            ("script", "Writer"),
            ("plot", "Writer"),
            ("story", "Writer"),
            ("penciler", "Penciller"),
            ("pencils", "Penciller"),
            ("breakdowns", "Penciller"),
            ("inks", "Inker"),
            ("finishes", "Inker"),
            ("embellisher", "Inker"),
            ("colours", "Colorist"),
            ("color separations", "Colorist"),
            ("letters", "Letterer"),
            ("cover artist", "Cover"),
            ("editor-in-chief", "Editor in Chief"),
        ],
    )
    def test_maps_a_source_spelling_onto_a_canonical_role(self, raw, expected):
        assert normalize_role(raw) == expected

    def test_matching_ignores_case_and_padding(self):
        assert normalize_role("  WRITER  ") == "Writer"

    def test_an_unknown_role_is_title_cased_rather_than_dropped(self):
        assert normalize_role("art assist") == "Art Assist"

    @pytest.mark.parametrize("raw", ["", "   ", None])
    def test_an_empty_role_is_none(self, raw):
        assert normalize_role(raw) is None

    def test_every_mapped_value_is_a_canonical_role(self):
        from metadata.credits import ROLE_MAP

        assert set(ROLE_MAP.values()) <= set(ROLE_ORDER)


class TestRoleRank:
    def test_ranks_by_position_in_the_display_order(self):
        assert role_rank("Writer") < role_rank("Colorist")
        assert role_rank("Colorist") < role_rank("Editor")

    def test_an_unknown_role_sorts_last(self):
        assert role_rank("Art Assist") == len(ROLE_ORDER)


class TestSortCredits:
    def test_orders_by_the_most_prominent_role(self):
        credits = [
            {"name": "L", "roles": ["Letterer"]},
            {"name": "W", "roles": ["Writer"]},
        ]
        sort_credits(credits)
        assert [c["name"] for c in credits] == ["W", "L"]

    def test_a_person_is_placed_by_their_highest_role(self):
        credits = [
            {"name": "Penciller only", "roles": ["Penciller"]},
            {"name": "Also writes", "roles": ["Letterer", "Writer"]},
        ]
        sort_credits(credits)
        assert [c["name"] for c in credits] == ["Also writes", "Penciller only"]

    def test_breaks_a_tie_by_name_case_insensitively(self):
        credits = [
            {"name": "zed", "roles": ["Writer"]},
            {"name": "Alpha", "roles": ["Writer"]},
        ]
        sort_credits(credits)
        assert [c["name"] for c in credits] == ["Alpha", "zed"]

    def test_a_credit_with_no_roles_sorts_last(self):
        credits = [{"name": "A", "roles": []}, {"name": "B", "roles": ["Editor"]}]
        sort_credits(credits)
        assert [c["name"] for c in credits] == ["B", "A"]

    def test_sorts_in_place(self):
        credits = [{"name": "B", "roles": ["Editor"]}, {"name": "A", "roles": ["Writer"]}]
        assert sort_credits(credits) is None
        assert credits[0]["name"] == "A"

    def test_empty_list(self):
        credits = []
        sort_credits(credits)
        assert credits == []


class TestMergeCredit:
    def test_creates_an_entry(self):
        by_name = {}
        merge_credit(by_name, "Fiona Staples", ["Artist"])
        assert by_name["fiona staples"] == {
            "name": "Fiona Staples",
            "roles": ["Artist"],
            "metronId": None,
            "cvUrl": None,
        }

    def test_accumulates_roles_across_appearances(self):
        by_name = {}
        merge_credit(by_name, "X", ["Writer"])
        merge_credit(by_name, "X", ["Artist"])
        assert by_name["x"]["roles"] == ["Writer", "Artist"]

    def test_does_not_duplicate_a_repeated_role(self):
        by_name = {}
        merge_credit(by_name, "X", ["Writer"])
        merge_credit(by_name, "X", ["Writer"])
        assert by_name["x"]["roles"] == ["Writer"]

    def test_keys_case_insensitively_but_keeps_the_first_spelling(self):
        by_name = {}
        merge_credit(by_name, "Fiona Staples", ["Artist"])
        merge_credit(by_name, "FIONA STAPLES", ["Cover"])
        assert len(by_name) == 1
        assert by_name["fiona staples"]["name"] == "Fiona Staples"
        assert by_name["fiona staples"]["roles"] == ["Artist", "Cover"]

    def test_trims_the_stored_name(self):
        by_name = {}
        merge_credit(by_name, "  X  ", ["Writer"])
        assert by_name["x"]["name"] == "X"

    def test_drops_falsy_roles(self):
        by_name = {}
        merge_credit(by_name, "X", ["Writer", None, ""])
        assert by_name["x"]["roles"] == ["Writer"]

    def test_records_source_ids_and_does_not_overwrite_them(self):
        by_name = {}
        merge_credit(by_name, "X", ["Writer"], metron_id=7, cv_url="a")
        merge_credit(by_name, "X", ["Artist"], metron_id=9, cv_url="b")
        assert by_name["x"]["metronId"] == 7
        assert by_name["x"]["cvUrl"] == "a"

    def test_a_later_appearance_can_supply_a_missing_id(self):
        by_name = {}
        merge_credit(by_name, "X", ["Writer"])
        merge_credit(by_name, "X", ["Artist"], metron_id=7)
        assert by_name["x"]["metronId"] == 7


class TestGetGalleryIssuePairs:
    def test_collects_distinct_pairs_sorted(self):
        panels = [
            {"slug": "saga", "issue": 4},
            {"slug": "arzach", "issue": 1},
            {"slug": "saga", "issue": 4},
        ]
        assert get_gallery_issue_pairs(panels) == [("arzach", 1), ("saga", 4)]

    def test_skips_a_free_form_issue(self):
        # Only whole-numbered issues can be looked up on Metron / Comic Vine.
        panels = [{"slug": "hellboy", "issue": "VOL 1"}, {"slug": "saga", "issue": 4}]
        assert get_gallery_issue_pairs(panels) == [("saga", 4)]

    def test_skips_a_panel_with_no_slug(self):
        assert get_gallery_issue_pairs([{"issue": 4}]) == []

    def test_truncates_a_float_issue(self):
        assert get_gallery_issue_pairs([{"slug": "x", "issue": 4.0}]) == [("x", 4)]

    def test_issue_zero_is_kept(self):
        assert get_gallery_issue_pairs([{"slug": "x", "issue": 0}]) == [("x", 0)]

    def test_empty_gallery(self):
        assert get_gallery_issue_pairs([]) == []


class TestPromoteCreators:
    def _index(self, artists):
        index = {}
        for a in artists:
            index[(a.get("name") or "").strip().lower()] = a
            for alias in a.get("aliases") or []:
                index.setdefault(alias.strip().lower(), a)
        return index

    def test_creates_an_entry_for_an_unknown_creator(self):
        artists, disambig = [], {}
        credits = [{"name": "Fiona Staples", "roles": ["Artist"]}]
        changed, _ = promote_creators(credits, artists, self._index(artists), set(), disambig)
        assert changed is True
        assert artists[0]["id"] == "fiona-staples"
        assert artists[0]["name"] == "Fiona Staples"

    def test_stamps_the_artist_id_onto_the_credit(self):
        artists = []
        credits = [{"name": "Fiona Staples", "roles": ["Artist"]}]
        promote_creators(credits, artists, self._index(artists), set(), {})
        assert credits[0]["artistId"] == "fiona-staples"

    def test_matches_an_existing_artist_case_insensitively(self):
        artists = [{"id": "fiona-staples", "name": "Fiona Staples", "references": []}]
        credits = [{"name": "FIONA STAPLES", "roles": ["Artist"]}]
        changed, _ = promote_creators(credits, artists, self._index(artists), {"fiona-staples"}, {})
        assert len(artists) == 1
        assert credits[0]["artistId"] == "fiona-staples"
        assert changed is False

    def test_matches_through_an_alias(self):
        artists = [
            {"id": "jean-giraud", "name": "Jean Giraud", "aliases": ["Moebius"], "references": []}
        ]
        credits = [{"name": "Moebius", "roles": ["Artist"]}]
        promote_creators(credits, artists, self._index(artists), {"jean-giraud"}, {})
        assert len(artists) == 1
        assert credits[0]["artistId"] == "jean-giraud"

    def test_suffixes_an_id_that_would_collide(self):
        artists = []
        credits = [{"name": "Chris Ware", "roles": ["Artist"]}]
        promote_creators(credits, artists, self._index(artists), {"chris-ware"}, {})
        assert artists[0]["id"] == "chris-ware-2"

    def test_keeps_suffixing_past_a_second_collision(self):
        artists = []
        credits = [{"name": "Chris Ware", "roles": ["Artist"]}]
        promote_creators(
            credits, artists, self._index(artists), {"chris-ware", "chris-ware-2"}, {}
        )
        assert artists[0]["id"] == "chris-ware-3"

    def test_a_new_metron_creator_gets_a_resolved_disambiguation_id(self):
        # So the artist backfill fetches the exact record instead of searching.
        artists, disambig = [], {}
        credits = [{"name": "X", "roles": ["Artist"], "metronId": 42}]
        _, dchanged = promote_creators(credits, artists, self._index(artists), set(), disambig)
        assert dchanged is True
        assert disambig["metron:creator"]["X"] == {"id": 42}

    def test_does_not_clobber_an_existing_resolved_id(self):
        artists = []
        disambig = {"metron:creator": {"X": {"id": 7}}}
        credits = [{"name": "X", "roles": ["Artist"], "metronId": 42}]
        promote_creators(credits, artists, self._index(artists), set(), disambig)
        assert disambig["metron:creator"]["X"] == {"id": 7}

    def test_adds_source_references_to_the_artist(self):
        artists = []
        credits = [{"name": "X", "roles": ["Artist"], "metronId": 42, "cvUrl": "https://cv/x"}]
        promote_creators(credits, artists, self._index(artists), set(), {})
        names = [r["name"] for r in artists[0]["references"]]
        assert names == ["Metron", "Comic Vine"]

    def test_a_second_pass_adds_no_duplicate_reference(self):
        artists = [{"id": "x", "name": "X", "references": []}]
        index = self._index(artists)
        credits = [{"name": "X", "roles": ["Artist"], "metronId": 42}]
        promote_creators(credits, artists, index, {"x"}, {})
        changed, _ = promote_creators(credits, artists, index, {"x"}, {})
        assert changed is False
        assert len(artists[0]["references"]) == 1

    def test_reports_a_reference_added_to_an_existing_artist_as_a_change(self):
        artists = [{"id": "x", "name": "X", "references": []}]
        credits = [{"name": "X", "roles": ["Artist"], "metronId": 42}]
        changed, _ = promote_creators(credits, artists, self._index(artists), {"x"}, {})
        assert changed is True

    def test_no_credits_changes_nothing(self):
        artists = []
        assert promote_creators([], artists, {}, set(), {}) == (False, False)
        assert artists == []
