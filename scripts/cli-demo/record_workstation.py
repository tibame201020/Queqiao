#!/usr/bin/env python3
import argparse
import json
import shutil
import time
from pathlib import Path

from record_interactive import (
    Recorder,
    Session,
    free_port,
    gateway_setup,
    render,
    wait_json,
    worker_setup,
    workstation_fixture,
)


def install_fake_clipboard(rec: Recorder) -> None:
    """Provide a recorder-local clipboard sink so one-time credentials never enter GIF frames."""
    helper = rec.prefix / "bin" / "wl-copy"
    helper.parent.mkdir(parents=True, exist_ok=True)
    helper.write_text("#!/bin/sh\ncat >/dev/null\n", encoding="utf-8")
    helper.chmod(0o755)


def drain(session: Session, pause: float = 0.3) -> None:
    time.sleep(pause)
    while session._drain_once(0.02):
        pass


def open_workstation(rec: Recorder, cast: Path) -> Session:
    install_fake_clipboard(rec)
    session = Session(rec, cast).start()
    session.command("queqiao workstation", "Queqiao Workstation")
    drain(session, 0.55)
    return session


def focus_inspector(session: Session, domain_key: str) -> None:
    session.send(domain_key.encode("ascii"), pause=0.35)
    session.tab(2)
    drain(session, 0.25)


def replace_default_text(session: Session, default_value: str, value: str) -> None:
    for _ in default_value:
        session.send(b"\x7f", pause=0.015)
    session.type(value, delay=0.018)
    session.enter()


def safe_stop(rec: Recorder, role: str, name: str) -> None:
    try:
        rec.run_noninteractive(role, "stop", f"--{role}", name, "--json")
    except Exception:
        pass


def seed_gateway(rec: Recorder, *, running: bool) -> int:
    gateway_port = free_port()
    management_port = free_port()
    gateway_setup(
        rec,
        None,
        "demo-gateway",
        str(gateway_port),
        str(management_port),
        public_url=f"http://127.0.0.1:{gateway_port}/",
    )
    if running:
        rec.run_noninteractive("gateway", "serve", "--gateway", "demo-gateway", "--bg", "--json")
        wait_json(rec, ["gateway", "status", "--gateway", "demo-gateway", "--json"], lambda value: value.get("active") is True)
    return gateway_port


def seed_worker(rec: Recorder, *, running: bool) -> int:
    worker_port = free_port()
    worker_setup(rec, None, "demo-worker", str(worker_port), custom=False)
    if running:
        rec.run_noninteractive("worker", "serve", "--worker", "demo-worker", "--bg", "--json")
        wait_json(rec, ["worker", "status", "--worker", "demo-worker", "--json"], lambda value: value.get("active") is True)
    return worker_port


def seed_pair(rec: Recorder, *, gateway_running: bool = True, worker_running: bool = True, enroll: bool = False) -> None:
    seed_gateway(rec, running=gateway_running)
    seed_worker(rec, running=worker_running)
    if enroll:
        join = json.loads(rec.run_noninteractive("gateway", "join-token", "--gateway", "demo-gateway", "--expires", "120", "--json"))
        rec.run_noninteractive("worker", "join", "--worker", "demo-worker", "--join-code", join["joinCode"], "--json")
        wait_json(
            rec,
            ["gateway", "status", "--gateway", "demo-gateway", "--json"],
            lambda value: value.get("active") is True and value.get("health", {}).get("healthy") is True,
        )


def quickstart_gateway_setup(rec: Recorder, cast: Path) -> None:
    gateway_port = free_port()
    management_port = free_port()
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"n"); session.wait_for("New Gateway", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Gateway name", after=mark)
        mark = session.mark(); session.type("demo-gateway"); session.enter(); session.wait_for("Public Gateway URL", after=mark)
        mark = session.mark(); session.type(f"http://127.0.0.1:{gateway_port}/"); session.enter(); session.wait_for("Gateway port", after=mark)
        mark = session.mark(); replace_default_text(session, "7575", str(gateway_port)); session.wait_for("Management port", after=mark)
        mark = session.mark(); replace_default_text(session, "7574", str(management_port)); session.wait_for("Worker session exposure", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Gateway configured", after=mark, timeout=12)
    finally:
        session.close(final_hold=3.0)


def quickstart_gateway_start(rec: Recorder, cast: Path) -> None:
    seed_gateway(rec, running=False)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"s"); session.wait_for("Gateway started", after=mark, timeout=12)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_worker_setup(rec: Recorder, cast: Path) -> None:
    seed_gateway(rec, running=True)
    worker_port = free_port()
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "2")
        mark = session.mark(); session.send(b"n"); session.wait_for("New Worker", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Worker name", after=mark)
        mark = session.mark(); session.type("demo-worker"); session.enter(); session.wait_for("Worker port", after=mark)
        mark = session.mark(); replace_default_text(session, "7576", str(worker_port)); session.wait_for("Initial Workspace", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Display name", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Access profile", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Worker configured", after=mark, timeout=12)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_worker_start(rec: Recorder, cast: Path) -> None:
    seed_gateway(rec, running=True)
    seed_worker(rec, running=False)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "2")
        mark = session.mark(); session.send(b"s"); session.wait_for("Worker started", after=mark, timeout=12)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_create_join_code(rec: Recorder, cast: Path) -> None:
    seed_pair(rec, gateway_running=True, worker_running=True, enroll=False)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"j"); session.wait_for("Join code expiry", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Join code created", after=mark, timeout=12)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_worker_join(rec: Recorder, cast: Path) -> None:
    seed_pair(rec, gateway_running=True, worker_running=True, enroll=False)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "2")
        mark = session.mark(); session.send(b"g"); session.wait_for("Enrollment source", after=mark)
        mark = session.mark(); session.enter(); session.wait_for("Worker protocols", after=mark, timeout=15)
        mark = session.mark(); session.enter(); session.wait_for("Worker joined Gateway", after=mark, timeout=15)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_gateway_detail(rec: Recorder, cast: Path) -> None:
    workstation_fixture(rec)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"i"); session.wait_for("DETAIL", after=mark)
        session.right(2)
        drain(session, 0.7)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_copy_mcp_url(rec: Recorder, cast: Path) -> None:
    seed_gateway(rec, running=True)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"c"); session.wait_for("MCP URL copied", after=mark, timeout=10)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "gateway", "demo-gateway")


def quickstart_copy_approval_secret(rec: Recorder, cast: Path) -> None:
    seed_gateway(rec, running=True)
    session = open_workstation(rec, cast)
    try:
        focus_inspector(session, "1")
        mark = session.mark(); session.send(b"p"); session.wait_for("Approval secret copied", after=mark, timeout=10)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "gateway", "demo-gateway")


def control_demo(rec: Recorder, cast: Path, control: str) -> None:
    workstation_fixture(rec)
    session = open_workstation(rec, cast)
    try:
        if control == "settings":
            mark = session.mark(); session.send(b","); session.wait_for("SETTINGS", after=mark)
            mark = session.mark(); session.enter(); session.wait_for("Choose color", after=mark)
            session.right(2); session.down(); drain(session, 0.6)
            return
        key = {"gateway": "1", "worker": "2", "workspace": "3", "profile": "4", "extension": "5", "diagnostics": "6"}[control]
        if control == "profile":
            session.send(key.encode("ascii"), pause=0.35)
            session.tab()
            session.down(2)
            session.tab()
        else:
            focus_inspector(session, key)
        if control == "diagnostics":
            mark = session.mark(); session.enter(); session.wait_for("Diagnostics complete", after=mark, timeout=15)
        else:
            session.down(2)
            drain(session, 0.7)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


def detail_demo(rec: Recorder, cast: Path, domain: str) -> None:
    workstation_fixture(rec)
    session = open_workstation(rec, cast)
    try:
        key = {"gateway": "1", "worker": "2", "workspace": "3", "profile": "4", "extension": "5", "diagnostics": "6"}[domain]
        if domain == "profile":
            session.send(key.encode("ascii"), pause=0.35)
            session.tab(); session.down(2); session.tab()
        else:
            focus_inspector(session, key)
        if domain == "diagnostics":
            drain(session, 0.8)
        mark = session.mark(); session.send(b"i"); session.wait_for("DETAIL", after=mark, timeout=10)
        tab_steps = {"gateway": 2, "worker": 4, "workspace": 1, "profile": 2, "extension": 1, "diagnostics": 4}[domain]
        for _ in range(tab_steps):
            session.right()
            drain(session, 0.45)
    finally:
        session.close(final_hold=3.0)
        safe_stop(rec, "worker", "demo-worker")
        safe_stop(rec, "gateway", "demo-gateway")


QUICKSTART = {
    "qs-gateway-setup": ("quickstart/01-gateway-setup", quickstart_gateway_setup),
    "qs-gateway-start": ("quickstart/02-gateway-start", quickstart_gateway_start),
    "qs-worker-setup": ("quickstart/03-worker-setup", quickstart_worker_setup),
    "qs-worker-start": ("quickstart/04-worker-start", quickstart_worker_start),
    "qs-create-join-code": ("quickstart/05-create-join-code", quickstart_create_join_code),
    "qs-worker-join": ("quickstart/06-worker-join", quickstart_worker_join),
    "qs-gateway-detail": ("quickstart/07-gateway-detail", quickstart_gateway_detail),
    "qs-copy-mcp-url": ("quickstart/08-copy-mcp-url", quickstart_copy_mcp_url),
    "qs-copy-approval-secret": ("quickstart/09-copy-approval-secret", quickstart_copy_approval_secret),
}

CONTROLS = {
    "control-gateways": ("controls/01-gateways", lambda rec, cast: control_demo(rec, cast, "gateway")),
    "control-workers": ("controls/02-workers", lambda rec, cast: control_demo(rec, cast, "worker")),
    "control-workspaces": ("controls/03-workspaces", lambda rec, cast: control_demo(rec, cast, "workspace")),
    "control-profiles": ("controls/04-access-profiles", lambda rec, cast: control_demo(rec, cast, "profile")),
    "control-extensions": ("controls/05-extensions", lambda rec, cast: control_demo(rec, cast, "extension")),
    "control-diagnostics": ("controls/06-diagnostics", lambda rec, cast: control_demo(rec, cast, "diagnostics")),
    "control-appearance": ("controls/07-settings-appearance", lambda rec, cast: control_demo(rec, cast, "settings")),
}

DETAILS = {
    "detail-gateway": ("details/01-gateway", lambda rec, cast: detail_demo(rec, cast, "gateway")),
    "detail-worker": ("details/02-worker", lambda rec, cast: detail_demo(rec, cast, "worker")),
    "detail-workspace": ("details/03-workspace", lambda rec, cast: detail_demo(rec, cast, "workspace")),
    "detail-profile": ("details/04-access-profile", lambda rec, cast: detail_demo(rec, cast, "profile")),
    "detail-extension": ("details/05-extension", lambda rec, cast: detail_demo(rec, cast, "extension")),
    "detail-diagnostics": ("details/06-diagnostics", lambda rec, cast: detail_demo(rec, cast, "diagnostics")),
}

ALL = {**QUICKSTART, **CONTROLS, **DETAILS}


def selected_demos(value: str) -> list[str]:
    if value == "all":
        return list(ALL)
    if value == "quickstart":
        return list(QUICKSTART)
    if value == "controls":
        return list(CONTROLS)
    if value == "details":
        return list(DETAILS)
    if value not in ALL:
        raise ValueError(f"Unknown Workstation demo: {value}")
    return [value]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--agg", required=True)
    parser.add_argument("--demo", default="all")
    args = parser.parse_args()

    out = Path(args.out)
    work = Path(args.work)
    agg = Path(args.agg)
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    files = []
    for name in selected_demos(args.demo):
        stem, runner = ALL[name]
        root = work / name
        shutil.rmtree(root, ignore_errors=True)
        cast = work / f"{name}.cast"
        rec = Recorder(root, args.package, width=140, height=34)
        runner(rec, cast)
        gif = out / f"{stem}.gif"
        render(agg, cast, gif)
        files.append({"demo": name, "cast": str(cast), "gif": str(gif), "bytes": gif.stat().st_size})
    print(json.dumps(files, indent=2))


if __name__ == "__main__":
    main()
