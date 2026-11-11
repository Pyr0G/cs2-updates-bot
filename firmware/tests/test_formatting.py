"""Regression tests execute the same C++ formatter used by the ESP firmware."""
from pathlib import Path
import html
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ZIG = Path(os.environ.get('ESP_TEST_ZIG', ROOT / '.local/test-tools/ziglang/zig.exe'))
CXX = os.environ.get('CXX') or (str(ZIG) if ZIG.exists() else shutil.which('g++'))

@unittest.skipUnless(CXX, 'Install Zig in firmware/.local/test-tools or set CXX to a native C++ compiler')
class FormattingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.tmp.name) / 'format.exe'
        compiler = [CXX] + (['c++'] if Path(CXX).stem == 'zig' else [])
        compiled = subprocess.run(compiler + ['-std=c++17', '-O1', str(ROOT/'tests/format_runner.cpp'), '-o', str(cls.binary)], capture_output=True, timeout=180)
        if compiled.returncode:
            cls.tmp.cleanup()
            raise RuntimeError(compiled.stderr.decode(errors='replace'))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_format(self, source, accepted=True):
        path = Path(self.tmp.name) / 'source.txt'
        path.write_text(source, encoding='utf8')
        p = subprocess.run([str(self.binary), str(path)], capture_output=True, timeout=10)
        self.assertEqual(p.returncode, 0 if accepted else 2, p.stderr.decode(errors='replace'))
        return p.stdout.decode('utf8').split('\x1e')[:-1]

    def test_real_october_23_preserves_every_paragraph(self):
        source = (ROOT.parent/'test/fixtures/oct23.bbcode').read_text(encoding='utf8')
        rendered = ''.join(self.run_format(source))
        literal = re.sub(r'\\([\\*_`~|\[\]])', r'\1', rendered)
        for paragraph in re.findall(r'\[p\](.*?)\[/p\]', source):
            self.assertIn(html.unescape(paragraph).replace('\\[','[').replace('\xa0',' '), literal)
        self.assertIn('[ MAP SCRIPTING ]', literal)
        self.assertEqual(literal.count('•'), source.count('[*]'))
        self.assertIn('Improved auto complete of the map_workshop command', literal)
        self.assertGreater(len(literal), 650)
        self.assertNotIn('AddedAdded', literal)

    def test_nested_lists_and_paragraphs(self):
        result = ''.join(self.run_format('[p]Heading[/p][list][*][p]Parent[/p][list][*][p]Child[/p][/*][/list][/*][*]Next[/*][/list]'))
        self.assertEqual(result, 'Heading\n\n• Parent\n\n  • Child\n\n• Next')

    def test_section_headings_are_not_tags(self):
        self.assertEqual(''.join(self.run_format('[ UI ]\n\\[ MAPS ]')), '\\[ UI \\]\n\\[ MAPS \\]')

    def test_html_entities_mentions_and_markdown(self):
        result = ''.join(self.run_format('<p>A &amp; B &#x1f600;</p><ul><li>@everyone *literal*</li></ul>'))
        self.assertEqual(result, 'A & B 😀\n\n• @\u200beveryone \\*literal\\*')

    def test_media_does_not_leak_markup_or_urls(self):
        self.assertEqual(''.join(self.run_format('[p]Before[/p][img]https://example.com/img[/img][p]After[/p]')), 'Before\n\nAfter')

    def test_long_notes_split_without_losing_unicode_or_escapes(self):
        source = ('😀 item_with_name\n' * 190).rstrip()
        parts = self.run_format(source)
        self.assertEqual(len(parts), 2)
        self.assertTrue(all(len(x.encode()) <= 3500 for x in parts))
        self.assertEqual(''.join(parts), source.replace('_','\\_'))

    def test_oversized_discord_output_is_rejected_not_truncated(self):
        self.run_format('x' * 5201, accepted=False)

    def test_oversized_source_is_rejected(self):
        self.run_format('[b]' * 11000, accepted=False)

    def test_pathological_nesting_is_rejected_before_expansion(self):
        self.run_format('[list]' * 100 + '[*]x', accepted=False)

    def test_screenshot_announcement_spacing_matches_source_paragraphs(self):
        source = (ROOT.parent/'test/fixtures/nov04.bbcode').read_text(encoding='utf8')
        result = ''.join(self.run_format(source))
        literal = re.sub(r'\\([\\*_`~|\[\]])', r'\1', result)
        paragraphs = [p.replace('\\[', '[') for p in re.findall(r'\[p\](.*?)\[/p\]', source)]
        self.assertEqual(literal.split('\n\n'), [p if p.startswith('[ ') else '• ' + p for p in paragraphs])
        self.assertEqual(literal.count('•'), 21)

    def test_plain_and_html_line_breaks_preserve_paragraph_spacing(self):
        self.assertEqual(''.join(self.run_format('First\nsecond\n\nThird\n\n\nFourth')), 'First\nsecond\n\nThird\n\nFourth')
        self.assertEqual(''.join(self.run_format('<p>First<br>second<br><br>Third</p><p></p><p>Fourth</p>')), 'First\nsecond\n\nThird\n\nFourth')

    def test_reference_announcement_spacing(self):
        source = (ROOT.parent/'test/fixtures/oct14.bbcode').read_text(encoding='utf8')
        result = ''.join(self.run_format(source))
        self.assertTrue(result.startswith('\\[ UI \\]\n\nDemo/Replay viewer improvements:\n\n• Added a progress bar'))
        self.assertEqual(len(result.split('\n\n')), 12)
        self.assertNotIn('\n\n\n', result)
