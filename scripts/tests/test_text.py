from metadata.text import (
    extract_year,
    is_meaningful_description,
    slugify,
    strip_html,
)


class TestStripHtml:
    def test_plain_text_survives(self):
        assert strip_html("Just a sentence.") == "Just a sentence."

    def test_paragraphs_become_crlf_pairs(self):
        assert strip_html("<p>One</p><p>Two</p>") == "One\r\n\r\nTwo"

    def test_br_becomes_a_line_break_inside_a_paragraph(self):
        # A single newline is not a paragraph split, so the halves rejoin.
        assert strip_html("One<br>Two") == "One Two"

    def test_list_items_become_dashes(self):
        # `</li>` emits a single newline, which is not a paragraph break, so
        # the items run together on one line rather than becoming paragraphs.
        assert strip_html("<ul><li>A</li><li>B</li></ul>") == "- A - B"

    def test_a_list_after_a_paragraph_keeps_the_paragraph_break(self):
        assert strip_html("<p>Intro</p><ul><li>A</li></ul>") == "Intro\r\n\r\n- A"

    def test_figures_and_images_are_dropped(self):
        assert strip_html("<figure><img src='x'>caption</figure>Body") == "Body"
        assert strip_html("<img src='x'/>Body") == "Body"

    def test_truncates_at_the_first_heading(self):
        # Comic Vine descriptions trail off into "List of issues" sections.
        raw = "<p>The intro.</p><h2>List of issues</h2><p>#1, #2</p>"
        assert strip_html(raw) == "The intro."

    def test_truncates_at_any_heading_level(self):
        assert strip_html("<p>Intro</p><h6>Collected editions</h6><p>x</p>") == "Intro"

    def test_entities_are_unescaped(self):
        assert strip_html("<p>Love &amp; Rockets</p>") == "Love & Rockets"

    def test_remaining_tags_are_stripped(self):
        assert strip_html("<p>An <b>important</b> word</p>") == "An important word"

    def test_runs_of_whitespace_collapse(self):
        assert strip_html("<p>A    B\t\tC</p>") == "A B C"

    def test_blank_paragraphs_are_dropped(self):
        assert strip_html("<p>A</p><p>  </p><p>B</p>") == "A\r\n\r\nB"

    def test_empty_input(self):
        assert strip_html("") == ""

    def test_tag_matching_is_case_insensitive(self):
        assert strip_html("<P>A</P><BR>B") == "A\r\n\r\nB"


class TestIsMeaningfulDescription:
    def test_rejects_a_stub(self):
        assert is_meaningful_description("Artist.") is False

    def test_rejects_a_long_enough_string_with_too_few_words(self):
        assert is_meaningful_description("Supercalifragilisticexpialidocious artist") is False

    def test_rejects_enough_words_but_too_few_characters(self):
        assert is_meaningful_description("a b c d e f") is False

    def test_accepts_a_real_description(self):
        text = "A French artist best known for his science fiction comics work."
        assert is_meaningful_description(text) is True

    def test_ignores_surrounding_whitespace(self):
        assert is_meaningful_description("   Artist.   ") is False

    def test_rejects_empty(self):
        assert is_meaningful_description("") is False


class TestExtractYear:
    def test_reads_a_year_from_a_display_string(self):
        assert extract_year("Dec 1, 1957") == 1957

    def test_reads_a_year_from_a_date_dict(self):
        assert extract_year({"date": "1957-02-01 00:00:00"}) == 1957

    def test_falls_back_to_a_year_key_in_a_dict(self):
        assert extract_year({"year": "1962"}) == 1962

    def test_accepts_1800s_through_2000s(self):
        assert extract_year("1899") == 1899
        assert extract_year("1900") == 1900
        assert extract_year("2026") == 2026

    def test_rejects_a_number_outside_the_plausible_range(self):
        assert extract_year("3050") is None
        assert extract_year("1750") is None

    def test_coerces_a_non_string_value(self):
        assert extract_year(1957) == 1957

    def test_none_and_empty_are_none(self):
        assert extract_year(None) is None
        assert extract_year("") is None
        assert extract_year({}) is None

    def test_no_year_present(self):
        assert extract_year("sometime in the fifties") is None


class TestSlugify:
    def test_lowercases_and_hyphenates(self):
        assert slugify("Love & Rockets") == "love-rockets"

    def test_collapses_separator_runs(self):
        assert slugify("A   B---C") == "a-b-c"

    def test_strips_leading_and_trailing_hyphens(self):
        assert slugify("  !Saga!  ") == "saga"

    def test_keeps_digits(self):
        assert slugify("2000 AD") == "2000-ad"

    def test_everything_stripped_leaves_an_empty_slug(self):
        assert slugify("!!!") == ""

    def test_matches_the_worker_slugify(self):
        # `credits.py` builds artist ids with this; the worker builds rating
        # target ids with its own copy of the same transform. A drift between
        # them would silently split one series across two keys.
        assert slugify("Saga") == "saga"
        assert slugify("Love & Rockets") == "love-rockets"
        assert slugify("2000 AD") == "2000-ad"
        assert slugify("Omaha the Cat Dancer") == "omaha-the-cat-dancer"

    def test_drops_non_ascii_the_way_the_worker_does(self):
        assert slugify("Épatant") == "patant"
