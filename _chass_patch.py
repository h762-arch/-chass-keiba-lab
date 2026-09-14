from pathlib import Path

p = Path("jra-result-fetch.mjs")
if not p.is_file():
    raise SystemExit("missing target: jra-result-fetch.mjs")

text = p.read_text(encoding="utf-8")

old_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1.2';"
new_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1.3';"

start_marker = "const identity=text.match("
end_marker = ";if(!date||!track||!race)"

if text.count(old_version) != 1:
    raise SystemExit(f"unexpected parser-version anchor count: {text.count(old_version)}")
if text.count(start_marker) != 1:
    raise SystemExit(f"unexpected identity start anchor count: {text.count(start_marker)}")
if text.count(end_marker) != 1:
    raise SystemExit(f"unexpected identity end anchor count: {text.count(end_marker)}")

start = text.index(start_marker)
end = text.index(end_marker, start) + 1
old_segment = text[start:end]

if "発走時刻" not in old_segment or "alt=[\"']" not in old_segment:
    raise SystemExit("current v1.2 identity segment does not match expected structure")

new_identity = r"""const postIndex=html.indexOf('発走時刻'),mainHtml=postIndex>=0?html.slice(postIndex,postIndex+12000):html,identity=text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*\d+回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\d+日\s*発走時刻[：:]?\s*\d{1,2}時\d{2}分/),date=identity?`${identity[1]}-${identity[2].padStart(2,'0')}-${identity[3].padStart(2,'0')}`:'',track=identity?.[4]||'',race=number(mainHtml.match(/alt=["'][^"']*?(\d{1,2})レース[^"']*["']/i)?.[1]||strip(mainHtml).match(/発走時刻[：:]?\s*\d{1,2}時\d{2}分[\s\S]{0,220}?(\d{1,2})レース/)?.[1]);"""

text = text[:start] + new_identity + text[end:]
text = text.replace(old_version, new_version, 1)

# Preserve fail-closed identity validation.
if "throw Error('JRA_RACE_MISMATCH')" not in text:
    raise SystemExit("JRA_RACE_MISMATCH guard missing after patch")

if text.count("JRA_RESULT_PARSER_VERSION='jra-official-result-v1.3'") != 1:
    raise SystemExit("parser version update failed")
if text.count("const postIndex=html.indexOf('発走時刻')") != 1:
    raise SystemExit("post-time scoped identity parser count is not 1")

p.write_text(text, encoding="utf-8")
print("patched jra-result-fetch.mjs -> parser v1.3 post-time scoped race identity")
