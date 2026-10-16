#!/usr/bin/env bash
# Captured-file consumer mutation proofs; restores product bytes on errors/signals.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
from pathlib import Path
import hashlib
import json
import os
import signal
import subprocess

root = Path.cwd()
logs = Path(os.environ.get('LOG_DIR', '/tmp/dc-b4-consumer-mutations'))
logs.mkdir(parents=True, exist_ok=True)
consumer = 'src/lib/view-models/agent-session-owner-consumer.test.svelte.ts'
generations = 'src/lib/view-models/agent-session-owner-generations.test.svelte.ts'

def stop(signum, frame):
    raise KeyboardInterrupt(f'signal {signum}')

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)

def close_noop(text):
    start = text.index('  close(mode: CloseMode): void {')
    end = text.index('\n  async reconnect()', start)
    return text[:start] + '  close(_mode: CloseMode): void {}\n' + text[end:]

def late_guard(text):
    start = text.index('  async open(agent: AgentInput)')
    return text[:start] + text[start:].replace('if (this.discardLate(attempt)) return', 'if (false && this.discardLate(attempt)) return', 1)

def pending_noop(text):
    start = text.index('export function cancelPendingDialogs')
    end = text.index('\n}', start) + 2
    return text[:start] + 'export function cancelPendingDialogs(_deps: PendingRequestDeps): void {}' + text[end:]

cases = [
    ('close', 'session/ws-connection.ts', close_noop, consumer, 'detach closes'),
    ('late-agent', 'session/ws-connection.ts', late_guard, generations, 'WS createAgent resolve'),
    ('pending', 'view-models/agent-session-pending.ts', pending_noop, consumer, 'leaveRunning cancels'),
    ('load-current', 'session/ws-load-attempt.ts', lambda t: t.replace('if (owner.discardLate(attempt)) return', 'if (false && owner.discardLate(attempt)) return'), generations, 'load createAgent resolve'),
    ('callback-gate', 'session/guard-acp-callbacks.ts', lambda t: t.replace('  return {', '  current = () => true\n  return {', 1), generations, 'all stale ACP callbacks'),
    ('close-once', 'session/ws-resource-attempt.ts', lambda t: t.replace('if (this.#clientClosed || !this.client) return', 'if (!this.client) return'), generations, 'WS newSession resolve'),
    ('delete-once', 'session/connection-allocation.ts', lambda t: t.replace('    if (entry.deleted) return\n', ''), generations, 'WS waitForOpen resolve'),
]
results = []
for name, relative, mutate, test, pattern in cases:
    path = root / 'packages/frontend/src/lib' / relative
    original = path.read_bytes()
    modified = mutate(original.decode()).encode()
    assert modified != original, f'{name}: mutation did not apply'
    command = ['bunx', 'vitest', 'run', test, '-t', pattern, '--maxWorkers=1']
    def run(phase):
        log = logs / f'{name}-{phase}.log'
        with log.open('w') as output:
            result = subprocess.run(command, cwd=root / 'packages/frontend', stdout=output, stderr=subprocess.STDOUT)
        (logs / f'{name}-{phase}.rc').write_text(str(result.returncode) + '\n')
        return result.returncode, log.read_text()
    pre, _ = run('pre-green')
    assert pre == 0, f'{name}: pre-green rc={pre}'
    try:
        path.write_bytes(modified)
        red, output = run('red')
    finally:
        path.write_bytes(original)
        assert path.read_bytes() == original, f'{name}: restoration failed'
    assert red == 1 and 'AssertionError:' in output, f'{name}: expected assertion red, got rc={red}'
    green, _ = run('restored-green')
    assert green == 0, f'{name}: restored-green rc={green}'
    results.append({'name': name, 'pre': pre, 'red': red, 'green': green, 'sourceSha256': hashlib.sha256(original).hexdigest(), 'command': command})
    (logs / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'{name}: assertion red -> restored green', flush=True)
print('All consumer mutations passed; product restored byte-for-byte.', flush=True)
PY
