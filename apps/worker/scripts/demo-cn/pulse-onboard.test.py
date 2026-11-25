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


    def test_r28_write_receipt_is_verified_on_upgrade_without_republishing(self):
        work = self.pending / "r28"
        work.mkdir(parents=True)
        revision = "a" * 32
        repository = "example/project"
        queued = work / "ember-queued.json"
        queued.write_text(json.dumps({
            "updates": {repository: {"revision": revision, "observedAt": "2026-11-25T00:00:00.000Z", "facts": {"goal": "fixture"}}},
            "receipts": {repository: {"status": "published", "revision": revision}},
        }))
        connector = Mock(ORIGIN="https://ember.example")
        connector.call_tool.side_effect = [OSError("network interrupted")] * 3
        with patch.object(onboard, "load_connector", return_value=connector), patch.object(onboard.time, "sleep"):
            channels = [{"project": repository, "room_id": "existing"}]
            result = onboard.publish_progress(channels)
            self.assertEqual(result[0]["readback_status"], "pending")
            connector.call_tool.reset_mock(side_effect=True)
            connector.call_tool.return_value = {"snapshot": {"revision": revision, "peer_confirmed": False}}
            self.assertEqual(onboard.publish_progress(channels)[0]["readback_status"], "verified")
            connector.call_tool.assert_called_once_with("read_project_snapshot", {"room_id": "existing"})
            self.assertEqual(onboard.publish_progress(channels), [])
        self.assertEqual(json.loads(queued.read_text())["readbacks"][repository]["readback_status"], "verified")

    def test_cycle_recovers_finished_draft_and_isolates_corrupt_queue(self):
        bad = self.pending / "broken"
        good = self.pending / "interrupted"
        bad.mkdir(parents=True)
        good.mkdir()
        (bad / "ember-queued.json").write_text("{")
        (good / "ember-projects.json").write_text('[{"repository":"example/project","goal":"fixture"}]')
        connector = Mock(ORIGIN="https://ember.example")
        revision = None
        def respond(name, payload):
            nonlocal revision
            if name == "sync_project_snapshot":
                revision = json.loads(payload["update_json"])["revision"]
                return {"revision": revision, "status": "published"}
            return {"snapshot": {"revision": revision, "peer_confirmed": False}}
        connector.call_tool.side_effect = respond
        with (
            patch.object(onboard, "verify_package"),
            patch.object(onboard, "load_connector", return_value=connector),
            patch.object(onboard, "bind_project_channels", return_value=[{"project":"example/project", "room_id":"existing"}]),
            patch.object(onboard, "collector") as collector,
        ):
            status, result = self.run_command("cycle", "--ember-only")
            self.assertEqual(status, 2)
            self.assertEqual({entry["status"] for entry in result["ember_posts"]}, {"quarantined", "published"})
            self.assertEqual((next(bad.glob("ember-queued.invalid-*.json"))).read_text(), "{")
            self.assertTrue((self.pending / "last-cycle.json").is_file())
            self.assertEqual(self.run_command("cycle", "--ember-only")[0], 0)
            self.assertEqual(connector.call_tool.call_count, 2)
            collector.assert_not_called()

    def test_cycle_overlap_returns_partial_without_touching_queue(self):
        with onboard.file_lock(self.pending / "report-cycle.lock"), patch.object(onboard, "verify_package"):
            status, result = self.run_command("cycle")
        self.assertEqual(status, 2)
        self.assertIn("already_running", result["incomplete"])
        self.assertFalse((self.pending / "last-cycle.json").exists())

    def test_failed_preflight_is_not_success(self):
        with (
            patch.object(onboard, "verify_package", return_value=1),
            patch.object(onboard, "onboarding_preflight", side_effect=lambda result, *_: result.update(next="login")),
            patch.object(onboard, "inspect_pulse", return_value={"status": "unavailable"}),
            patch.object(onboard, "collector", side_effect=OSError("not installed")),
            patch.object(onboard.sys, "platform", "win32"),
            patch.object(onboard, "load_connector"),
        ):
            status, result = self.run_command("preflight")
        self.assertEqual(status, 2)
        self.assertEqual(set(result["incomplete"]), {"collector", "pulse_connectivity", "login"})


    def test_cycle_continues_usage_when_ember_authorization_expires(self):
        draft = self.pending / "old-draft"
        draft.mkdir(parents=True)
        (draft / "ember-projects.json").write_text('[{"repository":"example/project","goal":"fixture"}]')

        def collect(action, work, *_):
            if action == "Prepare":
                work.mkdir()
                (work / "plan.json").write_text("{}")
                return {"prepared_batches": 1, "evidence": ["fixture evidence"]}
            self.assertEqual(action, "Submit")
            return {"submitted_batches": 1, "usage_verified": True}

        with (
            patch.object(onboard, "verify_package"),
            patch.object(onboard, "load_connector"),
            patch.object(onboard, "bind_project_channels", side_effect=ValueError("Ember authorization expired")),
            patch.object(onboard, "collector", side_effect=collect) as collector,
            patch.object(onboard, "bind_reporting_member"),
        ):
            status, result = self.run_command("cycle")
        self.assertEqual(status, 2)
        self.assertIn("channels", result["incomplete"])
        self.assertEqual(result["report"]["submitted_batches"], 1)
        self.assertNotIn("evidence", result["prepared"])
        self.assertTrue((draft / "ember-queued.json").is_file())
        self.assertEqual([call.args[0] for call in collector.call_args_list], ["Prepare", "Submit"])


if __name__ == "__main__":
    unittest.main()
