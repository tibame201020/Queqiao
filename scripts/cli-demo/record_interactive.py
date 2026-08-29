#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

CSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
OSC_RE = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")


def plain(text: str) -> str:
    text = OSC_RE.sub("", CSI_RE.sub("", text))
    return text.replace("\r", "")


class Recorder:
    def __init__(self, root: Path, package_spec: str, width: int = 110, height: int = 32):
        self.root = root
        self.package_spec = package_spec
        self.width = width
        self.height = height
        self.home = root / "home"
        self.prefix = root / "prefix"
        self.workspace = root / "workspace"
        for path in (self.home, self.prefix, self.workspace):
            path.mkdir(parents=True, exist_ok=True)
        self.env = os.environ.copy()
        self.env.update({
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_DATA_HOME": str(self.home / ".local" / "share"),
            "XDG_STATE_HOME": str(self.home / ".local" / "state"),
            "XDG_RUNTIME_DIR": str(root / "runtime"),
            "npm_config_prefix": str(self.prefix),
            "npm_config_audit": "false",
            "npm_config_fund": "false",
            "npm_config_update_notifier": "false",
            "PATH": f"{self.prefix / 'bin'}:{self.env['PATH']}",
            "TERM": "xterm-256color",
            "COLUMNS": str(width),
            "LINES": str(height),
            "NO_COLOR": "",
        })
        (root / "runtime").mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["npm", "install", "-g", package_spec, "--no-audit", "--no-fund"],
            env=self.env,
            cwd=self.workspace,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def run_noninteractive(self, *args: str) -> str:
        result = subprocess.run(
            ["queqiao", *args], env=self.env, cwd=self.workspace,
            text=True, capture_output=True, check=True,
        )
        return result.stdout

    def write_extension(self, stem: str, extension_id: str, display_name: str):
        ext = self.root / stem
        (ext / "dist").mkdir(parents=True, exist_ok=True)
        (ext / "dist" / "index.js").write_text(
            f'export default {{ manifest: {{ id: "{extension_id}", version: "1.0.0", displayName: "{display_name}" }}, activate() {{}} }};\n',
            encoding="utf-8",
        )
        package = {
            "name": f"queqiao-{stem}", "version": "1.0.0", "type": "module",
            "queqiao": {
                "apiVersion": 1,
                "module": "./dist/index.js",
                "manifest": {
                    "id": extension_id, "version": "1.0.0", "displayName": display_name,
                    "host": {"kind": "worker"},
                    "ordering": {"requires": [], "before": [], "after": []},
                    "contributions": [],
                },
            },
        }
        (ext / "package.json").write_text(json.dumps(package, indent=2), encoding="utf-8")
        return ext


class Session:
    def __init__(self, recorder: Recorder, cast_path: Path | None):
        self.recorder = recorder
        self.cast_path = cast_path
        self.master = None
        self.proc = None
        self.started = None
        self.raw = ""
        self.events = []

    def start(self):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", self.recorder.height, self.recorder.width, 0, 0))
        self.master = master
        def child_tty():
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        self.proc = subprocess.Popen(
            ["bash", "--noprofile", "--norc", "-i"],
            stdin=slave, stdout=slave, stderr=slave,
            env={**self.recorder.env, "PS1": "$ ", "PROMPT_COMMAND": ""},
            cwd=self.recorder.workspace,
            close_fds=True,
            preexec_fn=child_tty,
        )
        os.close(slave)
        self.started = time.monotonic()
        self.wait_for("$ ", timeout=6)
        return self

    def _time(self):
        return round(time.monotonic() - self.started, 6)

    def _drain_once(self, timeout=0.05):
        ready, _, _ = select.select([self.master], [], [], timeout)
        if not ready:
            return False
        try:
            data = os.read(self.master, 65536)
        except OSError:
            return False
        if not data:
            return False
        text = data.decode("utf-8", "replace")
        self.raw += text
        if self.cast_path is not None:
            self.events.append([self._time(), "o", text])
        return True

    def wait_for(self, needle: str, timeout=8, after=None):
        start = time.monotonic()
        offset = len(self.raw) if after is None else after
        while time.monotonic() - start < timeout:
            if needle in plain(self.raw[offset:]):
                time.sleep(0.18)
                while self._drain_once(0.02):
                    pass
                return
            self._drain_once(0.08)
        tail = plain(self.raw[-5000:])
        raise RuntimeError(f"Timed out waiting for {needle!r}. Tail:\n{tail}")

    def mark(self):
        return len(self.raw)

    def send(self, data: bytes, pause=0.18):
        os.write(self.master, data)
        time.sleep(pause)
        while self._drain_once(0.02):
            pass

    def type(self, text: str, delay=0.035):
        for ch in text:
            self.send(ch.encode("utf-8"), pause=delay)

    def enter(self): self.send(b"\r")
    def down(self, count=1):
        for _ in range(count): self.send(b"\x1b[B")
    def up(self, count=1):
        for _ in range(count): self.send(b"\x1b[A")
    def space(self): self.send(b" ")

    def command(self, command: str, wait_for: str | None = None):
        mark = self.mark()
        self.type(command)
        self.enter()
        if wait_for:
            self.wait_for(wait_for, after=mark)
        return mark

    def close(self, final_hold=1.1):
        time.sleep(final_hold)
        while self._drain_once(0.03):
            pass
        if self.proc and self.proc.poll() is None:
            self.send(b"\x04", pause=0.05)
            try: self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired: self.proc.kill()
        if self.cast_path is not None:
            self.cast_path.parent.mkdir(parents=True, exist_ok=True)
            header = {
                "version": 2,
                "width": self.recorder.width,
                "height": self.recorder.height,
                "timestamp": int(time.time()),
                "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"},
            }
            with self.cast_path.open("w", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(header, ensure_ascii=False) + "\n")
                for event in self.events:
                    fh.write(json.dumps(event, ensure_ascii=False) + "\n")
        try: os.close(self.master)
        except OSError: pass


def gateway_setup(rec: Recorder, cast: Path | None, name="demo-gateway", port="45775", management="45774", create_down=0):
    s = Session(rec, cast).start()
    try:
        s.command("queqiao gateway setup", "New Gateway")
        m=s.mark(); s.down(create_down); s.enter(); s.wait_for("Gateway name", after=m)
        m=s.mark(); s.type(name); s.enter(); s.wait_for("Public Gateway URL", after=m)
        m=s.mark(); s.type(f"https://gateway.example/{name}/"); s.enter(); s.wait_for("Gateway port", after=m)
        m=s.mark(); s.type(port); s.enter(); s.wait_for("Management port", after=m)
        m=s.mark(); s.type(management); s.enter(); s.wait_for("Gateway created", after=m)
    finally:
        s.close()


def worker_setup(rec: Recorder, cast: Path | None, name="demo-worker", port="45776", custom=False):
    s = Session(rec, cast).start()
    try:
        s.command("queqiao worker setup", "New Worker")
        m=s.mark(); s.enter(); s.wait_for("Worker name", after=m)
        m=s.mark(); s.type(name); s.enter(); s.wait_for("Worker port", after=m)
        m=s.mark(); s.type(port); s.enter(); s.wait_for("Workspace path", after=m)
        m=s.mark(); s.enter(); s.wait_for("Display name", after=m)
        m=s.mark(); s.enter(); s.wait_for("Access profile", after=m)
        if not custom:
            m=s.mark(); s.enter(); s.wait_for("Worker created", after=m)
            return
        m=s.mark(); s.down(2); s.enter(); s.wait_for("Tools", after=m)
        m=s.mark(); s.down(6); s.space(); s.enter(); s.wait_for("Allowed executables", after=m)
        m=s.mark(); s.type("git,npm"); s.enter(); s.wait_for("Save as profile?", after=m)
        m=s.mark(); s.enter(); s.wait_for("Worker created", after=m)
    finally:
        s.close()


def selector_demo(rec: Recorder, cast: Path):
    gateway_setup(rec, None, "alpha", "45875", "45874")
    gateway_setup(rec, None, "beta", "45975", "45974", create_down=1)
    s=Session(rec, cast).start()
    try:
        s.command("queqiao gateway status", "Gateway")
        m=s.mark(); s.down(); s.enter(); s.wait_for("Gateway:", after=m)
    finally:
        s.close()


def extension_demo(rec: Recorder, cast: Path):
    worker_setup(rec, None, "demo-worker", "46076", custom=False)
    first=rec.write_extension("extension-alpha", "dev.queqiao.alpha", "Alpha Extension")
    second=rec.write_extension("extension-beta", "dev.queqiao.beta", "Beta Extension")
    rec.run_noninteractive("extension", "install", str(first), "--json")
    rec.run_noninteractive("extension", "install", str(second), "--json")
    s=Session(rec, cast).start()
    try:
        s.command("queqiao extension attach", "Extension")
        m=s.mark(); s.down(); s.enter(); s.wait_for("Attached: dev.queqiao.beta", after=m)
    finally:
        s.close()


def render(agg: Path, cast: Path, gif: Path):
    gif.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        str(agg), "--quiet", "--font-size", "17", "--fps-cap", "20", "--last-frame-duration", "2.0",
        str(cast), str(gif)
    ], check=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--agg", required=True)
    parser.add_argument("--demo", choices=["all","gateway","worker","selector","extension"], default="all")
    args=parser.parse_args()
    out=Path(args.out); work=Path(args.work); agg=Path(args.agg)
    work.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)
    selected=["gateway","worker","selector","extension"] if args.demo=="all" else [args.demo]
    files=[]
    for index, name in enumerate(selected, start=1):
        root=work / name
        shutil.rmtree(root, ignore_errors=True)
        cast=work / f"{name}.cast"
        rec=Recorder(root, args.package)
        if name=="gateway": gateway_setup(rec, cast)
        elif name=="worker": worker_setup(rec, cast, custom=True)
        elif name=="selector": selector_demo(rec, cast)
        elif name=="extension": extension_demo(rec, cast)
        stems={
            "gateway":"01-gateway-setup",
            "worker":"02-worker-access-setup",
            "selector":"03-instance-selector",
            "extension":"04-extension-attach",
        }
        gif=out / f"{stems[name]}.gif"
        render(agg, cast, gif)
        files.append({"demo":name,"cast":str(cast),"gif":str(gif),"bytes":gif.stat().st_size})
    print(json.dumps(files, indent=2))


if __name__=="__main__":
    main()
