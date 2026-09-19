#!/usr/bin/env python3
"""Runs a command in a pseudo-terminal with a real window size and relays its
output unbuffered to stdout. forge only streams per-transaction progress on a
sized TTY; `script(1)` gives it a 0×0 pty and everything arrives at the end."""
import fcntl
import os
import pty
import select
import struct
import sys
import termios

cmd = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 200, 0, 0))
out = sys.stdout.buffer
while True:
    try:
        r, _, _ = select.select([fd], [], [], 0.2)
    except InterruptedError:
        continue
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out.write(data)
        out.flush()
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
