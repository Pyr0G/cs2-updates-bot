import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('device', Path(__file__).parents[1] / 'tools' / 'device.py')
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)


def article(gid, date):
    return {'gid': gid, 'date': date, 'appid': 730, 'feedname': 'steam_community_announcements'}


def feed(*items):
    return {'appnews': {'appid': 730, 'newsitems': list(items)}}


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.source = {'version': 1, 'channel': '123456789012345678', 'since': 100,
                       'seen': ['1', '2', '3'], 'pending': None}

    def test_keeps_only_seen_boundary_and_leaves_unseen_ties_for_delivery(self):
        result = device.convert_history(self.source, feed(article('4', 100), article('3', 100), article('2', 99)))
        self.assertEqual(result['ids'], ['3'])
        self.assertEqual(result['since'], 100)

    def test_pending_delivery_survives_migration(self):
        self.source['pending'] = {'gid': '4', 'date': 101, 'title': 'Update', 'url': 'https://steamcommunity.com/x'}
        result = device.convert_history(self.source, feed(article('3', 100)))
        self.assertEqual(result['pending'], self.source['pending'])

    def test_manual_skips_newer_than_watermark_survive(self):
        self.source['seen'].append('5')
        result = device.convert_history(self.source, feed(article('5', 101), article('3', 100)))
        self.assertIn('5', result['skip'])
        self.assertEqual(result['since'], 100)

    def test_incomplete_boundary_is_rejected(self):
        with self.assertRaises(ValueError):
            device.convert_history(self.source, feed(*(article(str(i), 100) for i in range(100))))

    def test_absent_checkpoint_is_not_silently_reset(self):
        with self.assertRaises(ValueError):
            device.convert_history(self.source, feed(article('2', 99)))

    def test_invalid_history_is_rejected(self):
        for value in (True, -1, 0, 2**32, '100'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                device.convert_history(dict(self.source, since=value), feed(article('3', 100)))

    def test_wrong_feed_is_rejected(self):
        bad = article('3', 100)
        bad['feedname'] = 'other'
        with self.assertRaises(ValueError):
            device.convert_history(self.source, feed(bad))

    def test_oversized_boundary_is_rejected(self):
        self.source['seen'] = [str(i) for i in range(33)]
        with self.assertRaises(ValueError):
            device.convert_history(self.source, feed(*(article(str(i), 100) for i in range(33))))

    def test_backward_pending_is_rejected(self):
        self.source['pending'] = {'gid': '4', 'date': 99}
        with self.assertRaises(ValueError):
            device.convert_history(self.source, feed(article('3', 100)))


if __name__ == '__main__':
    unittest.main()
