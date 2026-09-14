from pathlib import Path

p = Path("jra-result-fetch.mjs")
if not p.is_file():
    raise SystemExit("missing target: jra-result-fetch.mjs")

text = p.read_text(encoding="utf-8")

old_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1';"
new_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1.1';"

start_marker = "const date=jpDate(text),track=JRA_TRACKS.find("
end_marker = ";if(!date||!track||!race)"

if text.count(old_version) != 1:
    raise SystemExit(f"unexpected parser-version anchor count: {text.count(old_version)}")
if text.count(start_marker) != 1:
    raise SystemExit(f"unexpected race-identity start anchor count: {text.count(start_marker)}")
if text.count(end_marker) != 1:
    raise SystemExit(f"unexpected race-identity end anchor count: {text.count(end_marker)}")

# IMPORTANT:
# Replace the identity segment BEFORE changing the version string.
# This avoids shifting the stored offsets in this minified one-line source.
start = text.index(start_marker)
end = text.index(end_marker, start) + 1  # consume the old trailing semicolon
old_segment = text[start:end]

if "race=number(text.match" not in old_segment:
    raise SystemExit("race-identity segment safety check failed")
if not (100 <= len(old_segment) <= 500):
    raise SystemExit(f"unexpected race-identity segment length: {len(old_segment)}")

new_identity = r"""const identity=text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*\d+回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\d+日\s*発走時刻[：:]?\s*\d{1,2}時\d{2}分[\s\S]{0,120}?(\d{1,2})レース/),date=identity?`${identity[1]}-${identity[2].padStart(2,'0')}-${identity[3].padStart(2,'0')}`:'',track=identity?.[4]||'',race=number(identity?.[5]);"""

text = text[:start] + new_identity + text[end:]
text = text.replace(old_version, new_version, 1)

# Fail closed: the existing identity mismatch guard must remain.
if "throw Error('JRA_RACE_MISMATCH')" not in text:
    raise SystemExit("JRA_RACE_MISMATCH guard missing after patch")

# Sanity: old identity parser must be gone and new parser/version must exist once.
if start_marker in text:
    raise SystemExit("old race-identity parser still present")
if text.count("JRA_RESULT_PARSER_VERSION='jra-official-result-v1.1'") != 1:
    raise SystemExit("parser version update failed")
if text.count("const identity=text.match(") != 1:
    raise SystemExit("new race-identity parser count is not 1")

p.write_text(text, encoding="utf-8")
print("patched jra-result-fetch.mjs -> parser v1.1 header identity")
