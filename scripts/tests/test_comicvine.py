from metadata.sources import pick_exact_match
from metadata.sources.comicvine import filter_volumes_by_start_year


class TestFilterVolumesByStartYear:
    def test_no_known_start_year_filters_nothing(self):
        results = [{"start_year": "1989"}, {"start_year": "2026"}]
        assert filter_volumes_by_start_year(results, None) == results

    def test_drops_a_volume_from_the_wrong_relaunch(self):
        results = [{"id": 4201, "start_year": "1989"}, {"id": 9999, "start_year": "2026"}]
        assert filter_volumes_by_start_year(results, 2026) == [
            {"id": 9999, "start_year": "2026"}
        ]

    def test_keeps_a_volume_with_no_start_year(self):
        results = [{"id": 1}, {"id": 2, "start_year": "1989"}]
        assert filter_volumes_by_start_year(results, 2026) == [{"id": 1}]

    def test_a_known_year_outranks_the_count_of_issues_tiebreak(self):
        # Without the filter, `count_of_issues` hands back the 127-issue 1989
        # volume for a panel out of the 2026 relaunch — and because Comic Vine
        # runs first, that wrong year is what Metron and GCD then trust.
        results = [
            {"name": "Legion of Super-Heroes", "start_year": "1989", "count_of_issues": 127},
            {"name": "Legion of Super-Heroes", "start_year": "2026", "count_of_issues": 1},
        ]
        candidates = filter_volumes_by_start_year(results, 2026)
        match = pick_exact_match(
            candidates, "Legion of Super-Heroes", tiebreak_key="count_of_issues"
        )
        assert match["start_year"] == "2026"

    def test_falls_back_to_the_tiebreak_when_the_year_is_unknown(self):
        results = [
            {"name": "Legion of Super-Heroes", "start_year": "1989", "count_of_issues": 127},
            {"name": "Legion of Super-Heroes", "start_year": "2026", "count_of_issues": 1},
        ]
        candidates = filter_volumes_by_start_year(results, None)
        match = pick_exact_match(
            candidates, "Legion of Super-Heroes", tiebreak_key="count_of_issues"
        )
        assert match["start_year"] == "1989"
