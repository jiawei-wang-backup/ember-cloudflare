import contextlib
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("pulse_onboard", Path(__file__).with_name("pulse-onboard.py"))
onboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(onboard)
SOURCE = "11111111-1111-4111-8111-111111111111"


class OnboardingTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.package = Path(temp.name)
        self.pending = self.package / ".pulse-pending"
        self.selection = self.package / ".pulse-project-selection.json"
        self.selection.write_text(json.dumps({
            "schema_version": 1, "confirmed_at": "2026-11-24", "ember_paired": onboard.PAIRED_SCOPE,
            "projects": [{"repository": "example/project", "source_ids": [SOURCE]}],
        }), encoding="utf8")
        for name, value in {"PACKAGE": self.package, "PENDING": self.pending}.items():
            patcher = patch.object(onboard, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_command(self, *args):
        output = io.StringIO()
        with patch.object(sys, "argv", ["pulse-onboard.py", *args]), contextlib.redirect_stdout(output):
            status = onboard.main()
        return status, json.loads(output.getvalue())

    def test_reports_even_if_ember_is_offline_and_retries_ember_only(self):
        connector = Mock(ORIGIN="https://ember.example")
        connector.call_tool.side_effect = OSError("Ember offline")
        with (
            patch.object(onboard, "load_connector", return_value=connector),
            patch.object(onboard, "collector", return_value={"status": "committed"}) as collector,
        ):
            status, prepared = self.run_command("prepare")
            self.assertEqual(status, 0)
            connector.call_tool.assert_not_called()
            work = Path(prepared["work_dir"])
            work.mkdir()
            (work / "plan.json").write_text("{}")
            status, receipt = self.run_command("submit", "--work-dir", str(work))
            self.assertEqual(status, 2)
            self.assertEqual(receipt["report"]["status"], "committed")
            self.assertIn("channels", receipt["incomplete"])
            with patch.object(onboard, "check_listener"):
                self.run_command("sync-ember")
            self.assertEqual([call.args[0] for call in collector.call_args_list].count("Submit"), 1)

    def test_reuses_authoritative_room_after_listing(self):
        room = {"id": "existing", "kind": "open"}
        connector = Mock()
        connector.call_tool.side_effect = [{"rooms": [room]}, {"status": "matched", "room": room}]
        with patch.object(onboard, "load_connector", return_value=connector):
            result = onboard.bind_project_channels()
        self.assertEqual([call.args[0] for call in connector.call_tool.call_args_list],
                         ["list_rooms", "find_project_channel"])
        self.assertEqual(result[0]["room_id"], "existing")
        self.assertEqual(json.loads(self.selection.read_text())["projects"][0]["ember_room_id"], "existing")

    def test_snapshot_is_queued_on_failure_and_retried_without_pulse(self):
        room = {"id": "existing", "kind": "closed"}
        connector = Mock(ORIGIN="https://ember.example")

        published = {}
        def response(tool, arguments):
            if tool == "list_rooms":
                return {"rooms": [room]}
            if tool == "find_project_channel":
                return {"status": "matched", "room": room}
            if tool == "read_project_snapshot":
                return {"snapshot":{"revision":published["revision"], "peer_confirmed":False}}
            update = json.loads(arguments["update_json"])
            published.update(update)
            return {"status": "published", "revision": update["revision"]}

        with patch.object(onboard, "load_connector", return_value=connector), patch.object(onboard, "collector") as collector:
            status, prepared = self.run_command("prepare-ember")
            self.assertEqual(status, 0)
            work = Path(prepared["work_dir"])
            (work / "ember-projects.json").write_text(json.dumps([{
                "repository": "example/project", "progress": ["Verified work"],
            }]), encoding="utf-8")
            connector.call_tool.side_effect = OSError("Ember offline")
            status, failed = self.run_command("sync-ember", "--work-dir", str(work))
            self.assertEqual(status, 2)
            self.assertIn("ember_posts", failed["incomplete"])
            revision = failed["ember_posts"][0]["revision"]
            connector.call_tool.side_effect = response
            status, restored = self.run_command("sync-ember")
            self.assertEqual(status, 0)
            self.assertEqual(restored["ember_posts"][0]["revision"], revision)
            self.assertEqual(restored["ember_posts"][0]["status"], "published")
            self.assertEqual(restored["ember_posts"][0]["readback_status"], "verified")
            self.assertEqual(self.run_command("sync-ember")[1]["ember_posts"], [])
            collector.assert_not_called()

    def test_only_missing_allows_creation(self):
        for state in ("forbidden", "ambiguous", "missing"):
            with self.subTest(state=state):
                connector = Mock()
                connector.call_tool.side_effect = [{"rooms": []}, {"status": state},
                                                   {"room": {"id": "created", "kind": "closed"}}]
                with patch.object(onboard, "load_connector", return_value=connector):
                    result = onboard.bind_project_channels()
                self.assertEqual(connector.call_tool.call_count, 3 if state == "missing" else 2)
                self.assertEqual(result[0]["status"], "resolved" if state == "missing" else "pending")

    def test_wrong_workspace_stops_before_channel_lookup(self):
        connector = Mock(ORIGIN="https://ember.example")
        connector.check_workspace.side_effect = ValueError("工作区不一致")
        with patch.object(onboard, "load_connector", return_value=connector):
            status, result = self.run_command("bind-channels")
        self.assertEqual(status, 2)
        self.assertIn("工作区不一致", result["ember_binding_error"])
        connector.call_tool.assert_not_called()

    def test_detects_corrupt_package_before_network_access(self):
        files = ["ember-workspace.json", "Ember-LAN-CA.pem", "pulse-onboard.py", "ember-connect.py", "ember-member-listener.py"]
        for name in files:
            (self.package / name).write_bytes(b"fixture")
        digest = hashlib.sha256(b"fixture").hexdigest()
        (self.package / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name in files))
        self.assertEqual(onboard.verify_package(), len(files))
        (self.package / "Ember-LAN-CA.pem").write_bytes(b"corrupt")
        connector = Mock(ORIGIN="https://ember.example")
        with patch.object(onboard, "load_connector", return_value=connector):
            status, result = self.run_command("preflight")
        self.assertEqual(status, 1)
        self.assertIn("Ember-LAN-CA.pem", result["error"])
        connector.check_workspace.assert_not_called()


if __name__ == "__main__":
    unittest.main()
