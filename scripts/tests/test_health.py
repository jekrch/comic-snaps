from metadata.health import IntegrationHealth


class TestIntegrationHealth:
    def test_starts_willing_to_continue(self):
        assert IntegrationHealth("Metron").should_bail is False

    def test_a_throttle_flips_the_bail_flag(self):
        health = IntegrationHealth("Metron")
        health.mark_throttled("rate limited (429)")
        assert health.should_bail is True

    def test_reports_the_reason_on_stderr(self, capsys):
        health = IntegrationHealth("Metron")
        health.mark_throttled("request timed out")
        err = capsys.readouterr().err
        assert "Metron" in err
        assert "request timed out" in err
        assert "skipping remaining entries" in err

    def test_a_second_throttle_does_not_report_again(self, capsys):
        health = IntegrationHealth("Metron")
        health.mark_throttled("first")
        capsys.readouterr()
        health.mark_throttled("second")
        assert capsys.readouterr().err == ""
        assert health.should_bail is True

    def test_integrations_are_tracked_independently(self):
        metron = IntegrationHealth("Metron")
        comic_vine = IntegrationHealth("Comic Vine")
        metron.mark_throttled("429")
        assert comic_vine.should_bail is False

    def test_the_flag_can_be_cleared_for_a_patient_retry(self):
        # `metron_get_patient` clears it to retry after the rate-limit window.
        health = IntegrationHealth("Metron")
        health.mark_throttled("429")
        health.should_bail = False
        assert health.should_bail is False
