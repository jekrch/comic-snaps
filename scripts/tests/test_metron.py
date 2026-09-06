import pytest

from metadata.sources.metron import (
    extract_metron_artist_fields,
    extract_metron_series_fields,
    filter_series_by_start_year,
    metron_resource_url,
    normalize_series_results,
    parse_year_began,
)


class TestNormalizeSeriesResults:
    def test_lifts_a_plain_name_out_of_the_display_string(self):
        # Metron series *list* results carry "Hup (1987)" under "series" and
        # no "name" key at all, so generic name matching never hits.
        results = [{"id": 1, "series": "Hup (1987)"}]
        normalize_series_results(results)
        assert results[0]["name"] == "Hup"

    def test_lifts_the_year_alongside_the_name(self):
        results = [{"id": 1, "series": "Hup (1987)"}]
        normalize_series_results(results)
        assert results[0]["year_began"] == 1987

    def test_leaves_an_existing_name_alone(self):
        results = [{"id": 1, "name": "Real Name", "series": "Other (1987)"}]
        normalize_series_results(results)
        assert results[0]["name"] == "Real Name"

    def test_does_not_overwrite_an_existing_year(self):
        results = [{"id": 1, "series": "Hup (1987)", "year_began": 1990}]
        normalize_series_results(results)
        assert results[0]["year_began"] == 1990

    def test_a_display_string_with_no_year_becomes_the_whole_name(self):
        results = [{"id": 1, "series": "Hup"}]
        normalize_series_results(results)
        assert results[0]["name"] == "Hup"
        assert "year_began" not in results[0]

    def test_a_title_containing_parentheses_keeps_them(self):
        results = [{"id": 1, "series": "Hup (Deluxe) (1987)"}]
        normalize_series_results(results)
        assert results[0]["name"] == "Hup (Deluxe)"
        assert results[0]["year_began"] == 1987

    def test_a_result_with_no_display_string_is_left_bare(self):
        results = [{"id": 1}]
        normalize_series_results(results)
        assert "name" not in results[0]

    def test_returns_the_same_list_it_mutated(self):
        results = [{"id": 1, "series": "Hup (1987)"}]
        assert normalize_series_results(results) is results

    def test_empty_input(self):
        assert normalize_series_results([]) == []


class TestParseYearBegan:
    def test_reads_an_int_or_a_numeric_string(self):
        assert parse_year_began(1987) == 1987
        assert parse_year_began("1987") == 1987

    @pytest.mark.parametrize("value", [None, "", 0])
    def test_falsy_values_are_none(self, value):
        assert parse_year_began(value) is None

    @pytest.mark.parametrize("value", ["nineteen", [], {}])
    def test_unparseable_values_are_none(self, value):
        assert parse_year_began(value) is None


class TestFilterSeriesByStartYear:
    def test_no_known_start_year_filters_nothing(self):
        results = [{"year_began": 1988}, {"year_began": 1990}]
        assert filter_series_by_start_year(results, None) == results

    def test_drops_a_contradicting_year(self):
        # Metron's series search matches on title alone, so "Deadline"
        # returns every unrelated series sharing that name.
        results = [{"id": 1, "year_began": 1988}, {"id": 2, "year_began": 2002}]
        assert filter_series_by_start_year(results, 1988) == [{"id": 1, "year_began": 1988}]

    def test_keeps_a_result_with_no_year_since_that_is_not_a_contradiction(self):
        results = [{"id": 1}, {"id": 2, "year_began": 2002}]
        assert filter_series_by_start_year(results, 1988) == [{"id": 1}]

    def test_keeps_a_result_whose_year_is_unparseable(self):
        results = [{"id": 1, "year_began": "nope"}]
        assert filter_series_by_start_year(results, 1988) == results

    def test_compares_a_string_year_numerically(self):
        results = [{"id": 1, "year_began": "1988"}]
        assert filter_series_by_start_year(results, 1988) == results

    def test_can_filter_everything_out(self):
        assert filter_series_by_start_year([{"year_began": 2002}], 1988) == []

    def test_composes_with_normalize_series_results(self):
        # The docstring says to call it after normalize, which is what lifts
        # `year_began` out of the "Name (1988)" display string.
        results = normalize_series_results(
            [{"id": 1, "series": "Deadline (1988)"}, {"id": 2, "series": "Deadline (2002)"}]
        )
        assert [r["id"] for r in filter_series_by_start_year(results, 1988)] == [1]


class TestExtractMetronArtistFields:
    def test_pulls_birth_and_death_years(self):
        fields = extract_metron_artist_fields({"birth": "1938-05-18", "death": "2012-03-10"})
        assert fields["birthYear"] == 1938
        assert fields["deathYear"] == 2012

    def test_missing_dates_are_none(self):
        assert extract_metron_artist_fields({}) == {
            "birthYear": None,
            "deathYear": None,
            "aliases": None,
        }

    def test_collects_and_trims_aliases(self):
        assert extract_metron_artist_fields({"alias": ["  Moebius  ", "Gir"]})["aliases"] == [
            "Moebius",
            "Gir",
        ]

    def test_drops_blank_and_non_string_aliases(self):
        assert extract_metron_artist_fields({"alias": ["  ", None, 5, "Gir"]})["aliases"] == ["Gir"]

    def test_an_empty_alias_list_becomes_none_rather_than_an_empty_list(self):
        # `_set_if_missing` treats [] as empty anyway; None keeps the JSON tidy.
        assert extract_metron_artist_fields({"alias": []})["aliases"] is None
        assert extract_metron_artist_fields({"alias": ["  "]})["aliases"] is None


class TestExtractMetronSeriesFields:
    def test_reads_a_publisher_object(self):
        assert extract_metron_series_fields({"publisher": {"name": "Image"}})["publisher"] == "Image"

    def test_reads_a_publisher_string(self):
        assert extract_metron_series_fields({"publisher": "Image"})["publisher"] == "Image"

    def test_a_missing_publisher_is_none(self):
        assert extract_metron_series_fields({})["publisher"] is None

    def test_a_publisher_of_an_unexpected_shape_is_none(self):
        assert extract_metron_series_fields({"publisher": ["Image"]})["publisher"] is None

    def test_coerces_the_start_year_and_issue_count(self):
        fields = extract_metron_series_fields({"year_began": "1988", "issue_count": "12"})
        assert fields["startYear"] == 1988
        assert fields["issueCount"] == 12

    def test_unparseable_numbers_become_none(self):
        fields = extract_metron_series_fields({"year_began": "soon", "issue_count": []})
        assert fields["startYear"] is None
        assert fields["issueCount"] is None

    def test_a_zero_issue_count_reads_as_unknown(self):
        assert extract_metron_series_fields({"issue_count": 0})["issueCount"] is None


class TestMetronResourceUrl:
    def test_builds_a_series_url(self):
        assert metron_resource_url("series", {"id": 42}) == "https://metron.cloud/series/42/"

    def test_anything_that_is_not_series_is_a_creator(self):
        assert metron_resource_url("creator", {"id": 7}) == "https://metron.cloud/creator/7/"

    def test_is_none_without_an_id(self):
        assert metron_resource_url("series", {}) is None
        assert metron_resource_url("series", {"id": 0}) is None
