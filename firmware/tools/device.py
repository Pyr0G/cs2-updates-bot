"""Private serial provisioning and migration for CS2 Updates Bot Lite.

No credential values are printed. Configuration is sent over the local USB cable.
"""
import argparse
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIELDS = {
    'DISCORD_BOT_TOKEN': 'token',
    'DISCORD_APPLICATION_ID': 'application',
    'DISCORD_GUILD_ID': 'guild',
    'DISCORD_CHANNEL_ID': 'channel',
    'DISCORD_ROLE_ID': 'role',
}


def valid_id(value):
    return isinstance(value, str) and value.isascii() and value.isdigit() and 1 <= len(value) <= 20


def convert_history(original, feed):
    """Retain exactly the seen IDs at the current timestamp boundary.

    Require a full boundary in the Steam response, rather than guessing which
    historical IDs share the checkpoint timestamp. Pending deliveries survive.
    """
    if (original.get('version') != 1 or not valid_id(original.get('channel'))
            or type(original.get('since')) is not int or not 0 < original['since'] <= 0xffffffff
            or not isinstance(original.get('seen'), list)
            or not all(valid_id(x) for x in original['seen'])):
        raise ValueError('Invalid desktop posting history; no migration performed')
    news = feed.get('appnews', {})
    batch = news.get('newsitems')
    if news.get('appid') != 730 or not isinstance(batch, list):
        raise ValueError('Invalid Steam boundary response')
    for item in batch:
        if (item.get('appid') != 730 or item.get('feedname') != 'steam_community_announcements'
                or not valid_id(item.get('gid')) or type(item.get('date')) is not int):
            raise ValueError('Invalid Steam announcement')
    since = original['since']
    if len(batch) >= 100 and not any(item['date'] < since for item in batch):
        raise ValueError('Steam timestamp boundary is incomplete; refusing migration')
    boundary = [item['gid'] for item in batch if item['date'] == since and item['gid'] in original['seen']]
    # A historical feed omission prevents proof of the boundary. Stop rather than re-ping.
    if not boundary:
        raise ValueError('Checkpoint boundary not found in Steam; manual review needed')
    if len(original['seen']) > 256:
        raise ValueError('Imported history exceeds device capacity; review before migration')
    if len(boundary) > 32:
        raise ValueError('Checkpoint boundary exceeds device capacity')
    pending = original.get('pending')
    if pending is not None:
        if (not isinstance(pending, dict) or not valid_id(pending.get('gid'))
                or type(pending.get('date')) is not int or not since <= pending['date'] <= 0xffffffff):
            raise ValueError('Invalid pending delivery')
        pending = {key: pending[key] for key in ('gid', 'date', 'title', 'url') if key in pending}
    return {'version': 1, 'channel': original['channel'], 'since': since,
            'ids': list(dict.fromkeys(boundary)), 'skip': list(dict.fromkeys(original['seen'])), 'pending': pending}


def boundary_feed(since):
    query = urllib.parse.urlencode({'appid': 730, 'feeds': 'steam_community_announcements',
                                    'count': 100, 'maxlength': 1, 'enddate': since + 1})
    # Reject redirects, matching firmware host restrictions.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open('https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?' + query, timeout=30) as response:
        return json.load(response)


def prepare_config(env_path, output):
    if output.exists():
        config = json.loads(output.read_text(encoding='utf-8-sig'))
    else:
        config = {key: '' for key in ('ssid', 'password', *FIELDS.values())}
    for line in env_path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if key not in FIELDS:
            continue
        if value.startswith('"'):
            value = json.loads(value)
        elif len(value) >= 2 and value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        config[FIELDS[key]] = value
    if not all(config.get(field) for field in FIELDS.values()):
        raise ValueError('Existing env file is missing required bot fields')
    output.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    print('Bot configuration copied privately. Fill Wi-Fi fields in config.local.json.')


def serial_command(port, line, seconds=8):
    import serial
    # Explicitly disable modem signals before opening to avoid unnecessary resets.
    connection = serial.Serial()
    connection.port, connection.baudrate, connection.timeout = port, 115200, 0.2
    connection.dtr = connection.rts = False
    connection.open()
    with connection:
        time.sleep(0.4)
        connection.reset_input_buffer()
        encoded = (line + '\n').encode('utf-8')
        if len(encoded) > 8000:
            raise ValueError('Serial command exceeds device capacity')
        connection.write(encoded)
        connection.flush()
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            response = connection.readline()
            if response:
                print(response.decode('utf-8', errors='replace').rstrip())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='COM5')
    parser.add_argument('--seconds', type=float, default=8)
    subs = parser.add_subparsers(dest='command', required=True)
    for name in ('status', 'check', 'preview', 'poll', 'pause', 'standby', 'enable'):
        subs.add_parser(name)
    configure = subs.add_parser('configure')
    configure.add_argument('--config', type=Path, default=ROOT / 'config.local.json')
    prepare = subs.add_parser('prepare-config')
    prepare.add_argument('--env', type=Path, required=True)
    prepare.add_argument('--output', type=Path, default=ROOT / 'config.local.json')
    history = subs.add_parser('import-history')
    history.add_argument('--state', type=Path, required=True)
    for name in ('resolve-sent', 'resolve-retry'):
        subs.add_parser(name).add_argument('id')
    args = parser.parse_args()
    if args.command == 'prepare-config':
        prepare_config(args.env, args.output)
        return
    line = args.command
    if line == 'configure':
        config = json.loads(args.config.read_text(encoding='utf-8-sig'))
        if not config.get('ssid') or not config.get('token'):
            raise ValueError('Fill private Wi-Fi and bot configuration first')
        line += ' ' + json.dumps(config, separators=(',', ':'), ensure_ascii=False)
    elif line == 'import-history':
        original = json.loads(args.state.read_text(encoding='utf-8-sig'))
        migrated = convert_history(original, boundary_feed(original['since']))
        line = 'import ' + json.dumps(migrated, separators=(',', ':'), ensure_ascii=False)
    elif line.startswith('resolve-'):
        if not valid_id(args.id):
            raise ValueError('Supply an exact numeric Steam announcement ID')
        line += ' ' + args.id
    serial_command(args.port, line, args.seconds)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        # Never echo serialized configuration or raw HTTP bodies in errors.
        print('Operation failed. Check file format, required fields, connection and device status.')
        raise SystemExit(1) from None
