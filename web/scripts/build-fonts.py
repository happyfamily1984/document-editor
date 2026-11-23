#!/usr/bin/env python3
"""
한글 무료 글꼴(모두 SIL OFL 1.1)을 모아 앱에 넣을 수 있게 만든다.

  - 앱에 넣는 글꼴: public/fonts/*.woff2 와 public/fonts/fonts.css (보통·굵게 두 굵기)
  - 앱 안에서 받아 쓰는 글꼴: 목록만 src/font-catalog.json 에 적고, 파일은 jsDelivr(npm @kfonts)에서 받는다
  - 문서에 자주 나오는 상용 글꼴 이름(맑은 고딕, 굴림, 함초롬바탕 …)은 비슷한 무료 글꼴로 이어 준다

실행: cd web && python3 scripts/build-fonts.py   (인터넷, npm, curl, fonttools+brotli 필요)
"""
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import tarfile

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(WEB, '.font-cache')
OUT = os.path.join(WEB, 'public', 'fonts')
CATALOG = os.path.join(WEB, 'src', 'font-catalog.json')
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
JSD = 'https://cdn.jsdelivr.net/npm/'

# ── 앱에 넣는 글꼴 ──────────────────────────────────────────────
# (id, 이름(=CSS 글꼴 이름), 분류, 출처, 다른 이름들)
#   출처: ('kf', '@kfonts 패키지') · ('gf', 'google/fonts 폴더') · ('npm', 패키지, {굵기: 패키지 안 경로})
BUNDLED = [
    # 고딕
    ('nanumgothic', '나눔고딕', '고딕', ('kf', 'nanum-gothic'), ['NanumGothic', 'Nanum Gothic']),
    ('nanumbarungothic', '나눔바른고딕', '고딕', ('kf', 'nanum-barun-gothic'), ['NanumBarunGothic', 'Nanum Barun Gothic']),
    ('nanumsquare', '나눔스퀘어', '고딕', ('kf', 'nanum-square'), ['NanumSquare']),
    ('nanumsquareround', '나눔스퀘어라운드', '고딕', ('kf', 'nanum-square-round'), ['NanumSquareRound']),
    ('nanumsquareac', '나눔스퀘어 ac', '고딕', ('kf', 'nanum-square-ac'), ['NanumSquare_ac', 'NanumSquareAc']),
    ('notosanskr', 'Noto Sans KR', '고딕', ('gf', 'notosanskr'), ['본고딕', 'Source Han Sans KR', 'Noto Sans CJK KR']),
    ('pretendard', 'Pretendard', '고딕', ('npm', 'pretendard', {400: 'package/dist/web/static/woff2/Pretendard-Regular.woff2', 700: 'package/dist/web/static/woff2/Pretendard-Bold.woff2'}), ['프리텐다드']),
    ('suit', 'SUIT', '고딕', ('npm', '@sun-typeface/suit', {400: 'package/fonts/static/woff2/SUIT-Regular.woff2', 700: 'package/fonts/static/woff2/SUIT-Bold.woff2'}), ['수트']),
    ('wantedsans', 'Wanted Sans', '고딕', ('npm', 'wanted-sans', {400: 'package/fonts/webfonts/static/complete/woff2/WantedSans-Regular.woff2', 700: 'package/fonts/webfonts/static/complete/woff2/WantedSans-Bold.woff2'}), ['원티드 산스']),
    ('gowundodum', '고운돋움', '고딕', ('gf', 'gowundodum'), ['Gowun Dodum']),
    ('gothica1', 'Gothic A1', '고딕', ('gf', 'gothica1'), ['고딕 A1']),
    ('ibmplexsanskr', 'IBM Plex Sans KR', '고딕', ('gf', 'ibmplexsanskr'), []),
    ('lineseed', 'LINE Seed Sans KR', '고딕', ('kf', 'line-seed-sans-kr'), ['LINESeedKR', '라인 시드']),
    ('hgbareondotum', '학교안심 바른돋움', '고딕', ('kf', 'hakgyoansim-bareondotum'), []),
    ('hgsantteutdotum', '학교안심 산뜻돋움', '고딕', ('kf', 'hakgyoansim-santteutdotum'), []),
    # 명조
    ('nanummyeongjo', '나눔명조', '명조', ('kf', 'nanum-myeongjo'), ['NanumMyeongjo', 'Nanum Myeongjo']),
    ('maruburi', '마루 부리', '명조', ('kf', 'maruburi'), ['MaruBuri', '마루부리']),
    ('notoserifkr', 'Noto Serif KR', '명조', ('gf', 'notoserifkr'), ['본명조', 'Source Han Serif K', 'Noto Serif CJK KR']),
    ('gowunbatang', '고운바탕', '명조', ('gf', 'gowunbatang'), ['Gowun Batang']),
    ('hahmlet', '함렛', '명조', ('gf', 'hahmlet'), ['Hahmlet']),
    ('ridibatang', '리디바탕', '명조', ('kf', 'ridi-batang'), ['RIDIBatang']),
    ('hgbareonbatang', '학교안심 바른바탕', '명조', ('kf', 'hakgyoansim-bareonbatang'), []),
    ('hgsantteutbatang', '학교안심 산뜻바탕', '명조', ('kf', 'hakgyoansim-santteutbatang'), []),
    ('kcchanbit', 'KCC-한빛', '명조', ('kf', 'kcc-hanbit'), []),
    ('songmyung', '송명', '명조', ('gf', 'songmyung'), ['Song Myung']),
    # 손글씨
    ('nanumpen', '나눔손글씨 펜', '손글씨', ('kf', 'nanum-pen'), ['Nanum Pen Script', 'NanumPen']),
    ('nanumbrush', '나눔손글씨 붓', '손글씨', ('kf', 'nanum-brush'), ['Nanum Brush Script', 'NanumBrush']),
    ('nanumbarunpen', '나눔바른펜', '손글씨', ('kf', 'nanum-barun-pen'), ['NanumBarunpen']),
    ('ttobagttobag', '나눔손글씨 또박또박', '손글씨', ('kf', 'nanum-handwritting-ttobagttobag'), []),
    ('gaegu', '개구', '손글씨', ('gf', 'gaegu'), ['Gaegu']),
    ('himelody', '하이멜로디', '손글씨', ('gf', 'himelody'), ['Hi Melody']),
    ('gamjaflower', '감자꽃', '손글씨', ('gf', 'gamjaflower'), ['Gamja Flower']),
    ('poorstory', '서툰 이야기', '손글씨', ('gf', 'poorstory'), ['Poor Story']),
    ('singleday', '싱글데이', '손글씨', ('gf', 'singleday'), ['Single Day']),
    ('cutefont', '귀여운 글꼴', '손글씨', ('gf', 'cutefont'), ['Cute Font']),
    ('dokdo', '독도', '손글씨', ('gf', 'dokdo'), ['Dokdo']),
    ('eastseadokdo', '동해 독도', '손글씨', ('gf', 'eastseadokdo'), ['East Sea Dokdo']),
    # 꾸밈(제목)
    ('bmjua', '배민 주아', '꾸밈', ('kf', 'bm-jua'), ['BM JUA', 'Jua', '주아']),
    ('bmdohyeon', '배민 도현', '꾸밈', ('kf', 'bm-dohyeon'), ['BM DoHyeon', 'Do Hyeon', '도현']),
    ('bmhannapro', '배민 한나 Pro', '꾸밈', ('kf', 'bm-hanna-pro'), ['BM HANNA Pro']),
    ('bmhanna11', '배민 한나는 열한살', '꾸밈', ('kf', 'bm-hanna-11yrs'), ['BM HANNA 11yrs old']),
    ('bmhannaair', '배민 한나 Air', '꾸밈', ('kf', 'bm-hanna-air'), ['BM HANNA Air']),
    ('bmyeonsung', '배민 연성', '꾸밈', ('kf', 'bm-yeonsung'), ['BM YEONSUNG', 'Yeon Sung', '연성']),
    ('bmeuljiro', '배민 을지로', '꾸밈', ('kf', 'bm-euljiro'), ['BM EULJIRO']),
    ('bmeuljiro10', '배민 을지로10년후', '꾸밈', ('kf', 'bm-euljiro-10years-later'), ['BM EULJIRO 10yearslater']),
    ('kiranghaerang', '기랑해랑', '꾸밈', ('gf', 'kiranghaerang'), ['Kirang Haerang']),
    ('blackhansans', '검은고딕', '꾸밈', ('gf', 'blackhansans'), ['Black Han Sans']),
    ('gugi', '구기', '꾸밈', ('gf', 'gugi'), ['Gugi']),
    ('stylish', '스타일리시', '꾸밈', ('gf', 'stylish'), ['Stylish']),
    ('sunflower', '해바라기', '꾸밈', ('gf', 'sunflower'), ['Sunflower']),
    ('dongle', '동글', '꾸밈', ('gf', 'dongle'), ['Dongle']),
    ('orbit', '오르빛', '꾸밈', ('gf', 'orbit'), ['Orbit']),
    ('diphylleia', '산하엽', '꾸밈', ('gf', 'diphylleia'), ['Diphylleia']),
    ('gasoek', '가석', '꾸밈', ('gf', 'gasoekone'), ['Gasoek One']),
    ('moirai', '모이라이', '꾸밈', ('gf', 'moiraione'), ['Moirai One']),
    ('grandiflora', '능소화', '꾸밈', ('gf', 'grandifloraone'), ['Grandiflora One']),
    ('bagelfat', '베이글', '꾸밈', ('gf', 'bagelfatone'), ['Bagel Fat One']),
    ('bwpicture', '흑백사진', '꾸밈', ('gf', 'blackandwhitepicture'), ['Black And White Picture']),
    ('neodgm', 'Neo둥근모', '꾸밈', ('kf', 'neodgm'), ['NeoDunggeunmo']),
    # 코딩
    ('d2coding', 'D2Coding', '코딩', ('kf', 'd2coding'), ['D2 Coding']),
    ('nanumgothiccoding', '나눔고딕코딩', '코딩', ('gf', 'nanumgothiccoding'), ['NanumGothicCoding', 'Nanum Gothic Coding']),
]

# 문서에 자주 나오지만 기기에 없는 글꼴 → 비슷한 무료 글꼴
ALIASES = {
    'Noto Sans KR': ['맑은 고딕', 'Malgun Gothic', '한컴 고딕', 'Hancom Gothic', '애플 SD 산돌고딕 Neo', 'Apple SD Gothic Neo', '본고딕'],
    '나눔고딕': ['굴림', 'Gulim', '굴림체', 'GulimChe', '새굴림', 'New Gulim', '돋움', 'Dotum', '돋움체', 'DotumChe', '한컴돋움', 'Haansoft Dotum',
                 '함초롬돋움', 'HCR Dotum', 'HY중고딕', 'HYGothic-Medium', '휴먼고딕', '중고딕', '고딕', '나눔고딕 ExtraBold'],
    'Noto Serif KR': ['바탕', 'Batang', '바탕체', 'BatangChe', '한컴바탕', 'Haansoft Batang', '함초롬바탕', 'HCR Batang', '신명조', 'HY신명조', 'HYSinMyeongJo-Medium',
                      '휴먼명조', '명조', '견명조', 'HY견명조', 'HYGyeonMyeongJo', '한양신명조', '문체부 바탕체', 'AppleMyungjo'],
    '송명': ['궁서', 'Gungsuh', '궁서체', 'GungsuhChe', 'HY궁서', '휴먼옛체'],
    '검은고딕': ['HY헤드라인M', 'HYHeadLine-Medium', 'HY견고딕', 'HYGothic-Extra', '견고딕', '휴먼둥근헤드라인'],
    '나눔스퀘어라운드': ['HY둥근고딕', 'HY얕은샘물M', '휴먼둥근고딕'],
    '나눔손글씨 펜': ['HY엽서M', '휴먼편지체'],
    'D2Coding': ['Consolas', 'Courier New', 'Courier'],
}

# 받아 쓰는 글꼴에서 뺄 것(같은 글꼴의 OTF판·옛한글판 등)
SKIP_DOWNLOAD = re.compile(r'-otf$|yet-hangul|-ligature$|-code$|-low|nexon|eco$')


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def curl(url, dest=None):
    if dest and os.path.exists(dest):
        return dest
    if dest:
        run(['curl', '-sSfL', '--retry', '3', '-m', '300', '-o', dest + '.part', url])
        os.replace(dest + '.part', dest)
        return dest
    return run(['curl', '-sSfL', '--retry', '3', '-m', '60', url])


def npm_pack(pkg):
    """패키지를 받아 풀고 풀린 폴더를 돌려준다"""
    safe = pkg.replace('@', '').replace('/', '-')
    folder = os.path.join(CACHE, 'npm', safe)
    if not os.path.isdir(folder):
        os.makedirs(os.path.join(CACHE, 'npm'), exist_ok=True)
        name = run(['npm', 'pack', pkg, '--pack-destination', os.path.join(CACHE, 'npm')]).strip().splitlines()[-1]
        with tarfile.open(os.path.join(CACHE, 'npm', name)) as t:
            t.extractall(folder, filter='data')
        os.remove(os.path.join(CACHE, 'npm', name))
    return folder


def nearest(files, want):
    """{굵기: 파일} 에서 want 에 가장 가까운 것. 400은 위로, 700은 그대로 가까운 쪽"""
    return min(files, key=lambda w: (abs(w - want), w if want < 500 else -w))


def to_woff2(src, dest, wght=None):
    if os.path.exists(dest):
        return
    f = TTFont(src)
    if wght is not None and 'fvar' in f:
        axis = next(a for a in f['fvar'].axes if a.axisTag == 'wght')
        f = instancer.instantiateVariableFont(f, {'wght': max(axis.minValue, min(axis.maxValue, wght))}, updateFontNames=False)
    f.flavor = 'woff2'
    f.save(dest)


def build_bundled(entry):
    fid, name, cat, src, aliases = entry
    files = {}  # 굵기 → 출력 파일 이름
    kind = src[0]
    if kind == 'kf':
        pkg = npm_pack('@kfonts/' + src[1])
        meta = json.load(open(os.path.join(pkg, 'package', 'metadata.json')))
        avail = {}
        for f in meta['files']:
            if f.get('style', 'normal') != 'normal':
                continue
            w2 = os.path.splitext(f['filename'])[0] + '.woff2'
            if os.path.exists(os.path.join(pkg, 'package', w2)):
                avail[int(f['weight'])] = os.path.join(pkg, 'package', w2)
        for want in (400, 700):
            w = nearest(avail, want)
            if want == 700 and w < 600:
                continue
            out = f'{fid}-{want}.woff2'
            if not os.path.exists(os.path.join(OUT, out)):
                with open(avail[w], 'rb') as a, open(os.path.join(OUT, out), 'wb') as b:
                    b.write(a.read())
            files[want] = out
    elif kind == 'npm':
        pkg = npm_pack(src[1])
        for want, path in src[2].items():
            out = f'{fid}-{want}.woff2'
            with open(os.path.join(pkg, path), 'rb') as a, open(os.path.join(OUT, out), 'wb') as b:
                b.write(a.read())
            files[want] = out
    else:  # google/fonts
        meta = curl(GF + src[1] + '/METADATA.pb')
        avail = {}
        for m in re.finditer(r'style:\s*"(\w+)"\s*weight:\s*(\d+)\s*filename:\s*"([^"]+)"', meta):
            if m.group(1) == 'normal':
                avail[int(m.group(2))] = m.group(3)
        variable = any('[' in f for f in avail.values())
        os.makedirs(os.path.join(CACHE, 'gf'), exist_ok=True)
        for want in (400, 700):
            if variable:
                fn = next(iter(avail.values()))
                w = want
            else:
                w = nearest(avail, want)
                if want == 700 and w < 600:
                    continue
                fn = avail[w]
            ttf = curl(GF + src[1] + '/' + fn.replace('[', '%5B').replace(']', '%5D'), os.path.join(CACHE, 'gf', fn))
            out = f'{fid}-{want}.woff2'
            to_woff2(ttf, os.path.join(OUT, out), w if variable else None)
            files[want] = out
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files.values())
    print(f'  {name:<16} {cat:<4} {sorted(files)} {size / 1e6:.1f}MB', flush=True)
    return {'id': fid, 'name': name, 'cat': cat, 'aliases': aliases, 'files': files, 'size': size}


def download_list(bundled_pkgs):
    """앱 안에서 받아 쓰는 @kfonts 글꼴 목록"""
    found = json.loads(run(['npm', 'search', '@kfonts', '--searchlimit', '400', '--json']))
    pkgs = []
    for p in found:
        n = p['name']
        if not n.startswith('@kfonts/'):
            continue
        short = n.split('/', 1)[1]
        if short in bundled_pkgs or SKIP_DOWNLOAD.search(short):
            continue
        pkgs.append((short, p['version'], p.get('description', '')))

    def one(item):
        short, ver, desc = item
        base = f'{JSD}@kfonts/{short}@{ver}/'
        try:
            meta = json.loads(curl(base + 'metadata.json'))
        except Exception:
            return None
        if meta.get('license', {}).get('spdx') != 'OFL-1.1':
            return None
        avail = {}
        for f in meta['files']:
            if f.get('style', 'normal') == 'normal':
                avail[int(f['weight'])] = os.path.splitext(f['filename'])[0] + '.woff2'
        if not avail:
            return None
        files, size = {}, 0
        for want in (400, 700):
            w = nearest(avail, want)
            if want == 700 and w < 600:
                continue
            url = base + avail[w]
            head = run(['curl', '-sSIL', '-m', '60', url])
            if not re.search(r'^HTTP/\S+ 200', head, re.M):
                return None
            ln = re.findall(r'content-length:\s*(\d+)', head, re.I)
            size += int(ln[-1]) if ln else 0
            files[want] = url
        name = meta['family'][0]
        label = desc.replace(' typeface', '').strip() or name
        cat = '손글씨' if '손글씨' in label or '펜' in label else '명조' if re.search('바탕|명조|부리', label) else '고딕' if re.search('돋움|고딕|산스|Sans', label) else '꾸밈'
        return {'id': 'dl-' + short, 'name': name, 'label': label, 'cat': cat, 'files': files, 'size': size}

    with cf.ThreadPoolExecutor(12) as ex:
        out = [x for x in ex.map(one, pkgs) if x]
    seen, uniq = set(), []
    for x in out:  # 같은 글꼴이 이름만 다른 패키지로 있으면 하나만
        if x['name'] not in seen:
            seen.add(x['name']); uniq.append(x)
    out = uniq
    out.sort(key=lambda x: (x['cat'], x['label']))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    print('앱에 넣는 글꼴:')
    with cf.ThreadPoolExecutor(6) as ex:
        bundled = list(ex.map(build_bundled, BUNDLED))
    keep = {f for b in bundled for f in b['files'].values()}
    for f in os.listdir(OUT):
        if f.endswith('.woff2') and f not in keep:
            os.remove(os.path.join(OUT, f))

    css = ['/* scripts/build-fonts.py 가 만든 파일 — 직접 고치지 마세요 */']
    by_name = {b['name']: b for b in bundled}

    def faces(family, b, local_names):
        for w, f in sorted(b['files'].items()):
            locs = ''.join(f"local('{n}'), " for n in local_names) if w == 400 else ''
            css.append(f"@font-face {{ font-family: '{family}'; src: {locs}url('./{f}') format('woff2'); font-weight: {w}; font-display: swap; }}")
            if len(b['files']) == 1:  # 굵게가 없으면 같은 파일로 굵게도 받는다(브라우저가 가짜 굵게로 그림)
                css.append(f"@font-face {{ font-family: '{family}'; src: url('./{f}') format('woff2'); font-weight: 700; font-display: swap; }}")

    for b in bundled:
        faces(b['name'], b, [b['name']] + b['aliases'])
        for a in b['aliases']:
            faces(a, b, [a])
    for target, names in ALIASES.items():
        for a in names:
            faces(a, by_name[target], [a])
    with open(os.path.join(OUT, 'fonts.css'), 'w') as fh:
        fh.write('\n'.join(css) + '\n')

    print('받아 쓰는 글꼴 목록을 모으는 중…')
    downloads = download_list({e[3][1] for e in BUNDLED if e[3][0] == 'kf'})
    catalog = {
        'bundled': [{'id': b['id'], 'name': b['name'], 'cat': b['cat'], 'bold': 700 in b['files']} for b in bundled],
        'download': downloads,
        'aliases': {a: t for t, names in ALIASES.items() for a in names},
    }
    with open(CATALOG, 'w') as fh:
        json.dump(catalog, fh, ensure_ascii=False, indent=1)
    total = sum(b['size'] for b in bundled)
    print(f'앱에 넣는 글꼴 {len(bundled)}종 {total / 1e6:.1f}MB · 받아 쓰는 글꼴 {len(downloads)}종 {sum(d["size"] for d in downloads) / 1e6:.0f}MB')


if __name__ == '__main__':
    sys.exit(main())
