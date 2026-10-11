import pytest

from metadata.sources import (
    filter_by_start_year,
    parse_issue_number,
    parse_year_began,
    pick_exact_match,
)


class TestParseIssueNumber:
    def test_reads_an_integer(self):
        assert parse_issue_number(5) == 5
        assert parse_issue_number("5") == 5

    def test_zero_is_a_real_issue_number(self):
        # One-shots and specials carry issue 0; a truthiness test would lose it.
        assert parse_issue_number(0) == 0
        assert parse_issue_number("0") == 0

    def test_none_and_empty_are_none(self):
        assert parse_issue_number(None) is None
        assert parse_issue_number("") is None

    @pytest.mark.parametrize("value", ["½", "1.MU", "Annual", "1a"])
    def test_non_whole_numbers_are_none(self, value):
        assert parse_issue_number(value) is None

    def test_a_float_is_truncated_toward_zero(self):
        assert parse_issue_number(1.9) == 1

    def test_negative_numbers_pass_through(self):
        assert parse_issue_number("-1") == -1


class TestPickExactMatch:
    def test_finds_a_case_insensitive_exact_match(self):
        results = [{"name": "Other"}, {"name": "SAGA"}]
        assert pick_exact_match(results, "saga") == {"name": "SAGA"}

    def test_ignores_a_partial_match(self):
        assert pick_exact_match([{"name": "Saga of the Swamp Thing"}], "Saga") is None

    def test_is_none_when_nothing_matches(self):
        assert pick_exact_match([{"name": "Other"}], "Saga") is None

    def test_is_none_for_an_empty_result_set(self):
        assert pick_exact_match([], "Saga") is None

    def test_ignores_padding_on_both_sides(self):
        assert pick_exact_match([{"name": "  Saga  "}], " saga ") == {"name": "  Saga  "}

    def test_tolerates_a_result_with_no_name(self):
        assert pick_exact_match([{}, {"name": "Saga"}], "Saga") == {"name": "Saga"}

    def test_returns_the_first_of_several_without_a_tiebreak(self):
        results = [{"name": "Saga", "id": 1}, {"name": "Saga", "id": 2}]
        assert pick_exact_match(results, "Saga")["id"] == 1

    def test_a_tiebreak_picks_the_highest_value(self):
        results = [
            {"name": "Saga", "id": 1, "count_of_issues": 3},
            {"name": "Saga", "id": 2, "count_of_issues": 60},
        ]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 2

    def test_a_tiebreak_treats_a_missing_key_as_zero(self):
        results = [
            {"name": "Saga", "id": 1},
            {"name": "Saga", "id": 2, "count_of_issues": 1},
        ]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 2

    def test_a_tiebreak_is_ignored_when_only_one_matches(self):
        results = [{"name": "Saga", "id": 1}, {"name": "Other", "id": 2}]
        assert pick_exact_match(results, "Saga", "count_of_issues")["id"] == 1


class TestPickExactMatchPreferYear:
    # Comic Vine's four "The Demon" volumes, as a title search returns them.
    DEMON = [
        {"name": "The Demon", "id": 1972, "start_year": "1972", "count_of_issues": 16},
        {"name": "The Demon", "id": 1987, "start_year": "1987", "count_of_issues": 4},
        {"name": "The Demon", "id": 1990, "start_year": "1990", "count_of_issues": 59},
        {"name": "The Demon", "id": 2026, "start_year": "2026", "count_of_issues": 1},
    ]

    def pick(self, results, prefer_year, name="The Demon"):
        return pick_exact_match(
            results, name, "count_of_issues", prefer_year=prefer_year, year_key="start_year"
        )

    def test_a_preferred_year_outranks_the_count_of_issues_tiebreak(self):
        assert self.pick(self.DEMON, 2026)["id"] == 2026

    def test_without_a_preferred_year_the_tiebreak_decides(self):
        assert self.pick(self.DEMON, None)["id"] == 1990

    def test_a_year_no_result_has_falls_back_to_the_tiebreak(self):
        # A reprint's #1 can carry a year no volume started in; the hint
        # must not cost us the match.
        assert self.pick(self.DEMON, 1952)["id"] == 1990

    def test_never_rules_out_a_lone_exact_match(self):
        results = [
            {"name": "Tales Calculated to Drive You Mad", "id": 1, "start_year": "1997"},
            {"name": "Mad", "id": 2, "start_year": "1952"},
        ]
        assert self.pick(results, 1952, "Tales Calculated to Drive You Mad")["id"] == 1

    def test_the_tiebreak_still_applies_among_several_year_hits(self):
        results = [
            {"name": "Saga", "id": 1, "start_year": "2012", "count_of_issues": 3},
            {"name": "Saga", "id": 2, "start_year": "2012", "count_of_issues": 60},
            {"name": "Saga", "id": 3, "start_year": "1990", "count_of_issues": 99},
        ]
        assert self.pick(results, 2012, "Saga")["id"] == 2

    def test_reads_whichever_field_the_source_spells_it_with(self):
        results = [{"name": "The Demon", "id": 2945, "year_began": 1990},
                   {"name": "The Demon", "id": 99, "year_began": 2026}]
        match = pick_exact_match(results, "The Demon", prefer_year=2026, year_key="year_began")
        assert match["id"] == 99

    def test_is_ignored_without_a_year_key(self):
        assert pick_exact_match(self.DEMON, "The Demon", "count_of_issues",
                                prefer_year=2026)["id"] == 1990


class TestParseYearBegan:
    def test_reads_an_int_or_a_numeric_string(self):
        # Metron sends an int, Comic Vine a string.
        assert parse_year_began(1987) == 1987
        assert parse_year_began("1987") == 1987

    @pytest.mark.parametrize("value", [None, "", 0])
    def test_falsy_values_are_none(self, value):
        assert parse_year_began(value) is None

    @pytest.mark.parametrize("value", ["nineteen", [], {}])
    def test_unparseable_values_are_none(self, value):
        assert parse_year_began(value) is None


class TestFilterByStartYear:
    def test_no_known_start_year_filters_nothing(self):
        results = [{"start_year": "1989"}, {"start_year": "2026"}]
        assert filter_by_start_year(results, None, "start_year") == results

    def test_drops_a_contradicting_year(self):
        results = [{"id": 1, "start_year": "1989"}, {"id": 2, "start_year": "2026"}]
        assert filter_by_start_year(results, 2026, "start_year") == [
            {"id": 2, "start_year": "2026"}
        ]

    def test_keeps_a_result_with_no_year_since_that_is_not_a_contradiction(self):
        results = [{"id": 1}, {"id": 2, "start_year": "1989"}]
        assert filter_by_start_year(results, 2026, "start_year") == [{"id": 1}]

    def test_keeps_a_result_whose_year_is_unparseable(self):
        results = [{"id": 1, "start_year": "nope"}]
        assert filter_by_start_year(results, 2026, "start_year") == results

    def test_reads_whichever_field_the_source_spells_it_with(self):
        results = [{"id": 1, "year_began": 1989}, {"id": 2, "year_began": 2026}]
        assert filter_by_start_year(results, 2026, "year_began") == [
            {"id": 2, "year_began": 2026}
        ]

    def test_can_filter_everything_out(self):
        assert filter_by_start_year([{"start_year": "1989"}], 2026, "start_year") == []
