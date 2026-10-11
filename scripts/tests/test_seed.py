from metadata.seed import issue_one_years


class TestIssueOneYears:
    def test_maps_a_series_to_the_year_of_its_first_issue(self):
        panels = [{"slug": "the-demon", "issue": 1, "year": 2026}]
        assert issue_one_years(panels) == {"the-demon": 2026}

    def test_ignores_panels_from_later_issues(self):
        panels = [
            {"slug": "the-deadman", "issue": 5, "year": 2026},
            {"slug": "lobo", "issue": 2, "year": 1990},
        ]
        assert issue_one_years(panels) == {}

    def test_takes_the_earliest_of_several_issue_one_panels(self):
        panels = [
            {"slug": "saga", "issue": 1, "year": 2013},
            {"slug": "saga", "issue": 1, "year": 2012},
            {"slug": "saga", "issue": 1, "year": 2014},
        ]
        assert issue_one_years(panels) == {"saga": 2012}

    def test_reads_an_issue_number_written_as_a_string(self):
        assert issue_one_years([{"slug": "x", "issue": "1", "year": 1999}]) == {"x": 1999}

    def test_skips_a_free_form_issue(self):
        assert issue_one_years([{"slug": "x", "issue": "Vol 1", "year": 1999}]) == {}

    def test_skips_a_panel_with_no_usable_year(self):
        panels = [
            {"slug": "a", "issue": 1},
            {"slug": "b", "issue": 1, "year": None},
            {"slug": "c", "issue": 1, "year": "1999"},
            {"slug": "d", "issue": 1, "year": True},
        ]
        assert issue_one_years(panels) == {}

    def test_skips_a_panel_with_no_slug(self):
        assert issue_one_years([{"issue": 1, "year": 1999}]) == {}

    def test_empty_gallery(self):
        assert issue_one_years([]) == {}
