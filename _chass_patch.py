from pathlib import Path

p = Path("jra-result-fetch.mjs")
if not p.is_file():
    raise SystemExit("missing target: jra-result-fetch.mjs")

text = p.read_text(encoding="utf-8")

old_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1';"
new_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1.1';"

start_marker = "const date=jpDate(text),track=JRA_TRACKS.find("
end_marker = "if(!date||!track||!race)"

if text.count(old_version) != 1:
    raise SystemExit(f"unexpected parser-version anchor count: {text.count(old_version)}")
if text.count(start_marker) != 1:
    raise SystemExit(f"unexpected race-identity start anchor count: {text.count(start_marker)}")
if text.count(end_marker) != 1:
    raise SystemExit(f"unexpected race-identity end anchor count: {text.count(end_marker)}")

start = text.index(start_marker)
end = text.index(end_marker, start)
old_segment = text[start:end]

if "race=number(text.match" not in old_segment or len(old_segment) > 400:
    raise SystemExit("race-identity segment safety check failed")

new_identity = r"""const identity=text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*\d+回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\d+日\s*発走時刻[：:]?\s*\d{1,2}時\d{2}分[\s\S]{0,120}?(\d{1,2})レース/),date=identity?`${identity[1]}-${identity[2].padStart(2,'0')}-${identity[3].padStart(2,'0')}`:'',track=identity?.[4]||'',race=number(identity?.[5]);"""

text = text.replace(old_version, new_version, 1)
text = text[:start] + new_identity + text[end:]

if "throw Error('JRA_RACE_MISMATCH')" not in text:
    raise SystemExit("JRA_RACE_MISMATCH guard missing after patch")

if "JRA_RESULT_PARSER_VERSION='jra-official-result-v1.1'" not in text:
    raise SystemExit("parser version was not updated")

p.write_text(text, encoding="utf-8")
print("patched jra-result-fetch.mjs -> parser v1.1 header identity")
