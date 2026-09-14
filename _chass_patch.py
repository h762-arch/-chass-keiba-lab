from pathlib import Path

p = Path("jra-result-fetch.mjs")
if not p.is_file():
    raise SystemExit("missing target: jra-result-fetch.mjs")

text = p.read_text(encoding="utf-8")

old_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1';"
new_version = "export const JRA_RESULT_PARSER_VERSION='jra-official-result-v1.1';"

old_identity = r"""const date=jpDate(text),track=JRA_TRACKS.find(x=>new RegExp(`回${x}\d+日`).test(text))||'',race=number(text.match(/(\d{1,2})レース/)?.[1]);"""

new_identity = r"""const identity=text.match(new RegExp(`(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*\d+回(${JRA_TRACKS.join('|')})\d+日\s*発走時刻[：:]?\s*\d{1,2}時\d{2}分[\s\S]{0,120}?(\d{1,2})レース`)),date=identity?`${identity[1]}-${identity[2].padStart(2,'0')}-${identity[3].padStart(2,'0')}`:'',track=identity?.[4]||'',race=number(identity?.[5]);"""

if text.count(old_version) != 1:
    raise SystemExit(f"unexpected parser-version anchor count: {text.count(old_version)}")
if text.count(old_identity) != 1:
    raise SystemExit(f"unexpected race-identity anchor count: {text.count(old_identity)}")

text = text.replace(old_version, new_version, 1)
text = text.replace(old_identity, new_identity, 1)

# Safety: preserve the fail-closed identity check.
if "throw Error('JRA_RACE_MISMATCH')" not in text:
    raise SystemExit("JRA_RACE_MISMATCH guard missing after patch")

p.write_text(text, encoding="utf-8")
print("patched jra-result-fetch.mjs -> parser v1.1")
