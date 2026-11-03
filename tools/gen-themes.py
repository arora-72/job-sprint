"""Generates the new colour themes for Job Sprint and checks text contrast.
Run: python3 tools/gen-themes.py public/themes.css. Appends rules to public/themes.css between markers (re-runnable)."""
import re, sys

FIXED_L = "--inverse-bg:var(--text);--inverse-text:var(--bg);--backdrop:rgba(30,20,25,.45);--shadow-sm:0 1px 2px rgba(40,30,60,.06);--shadow:0 1px 2px rgba(40,30,60,.05),0 6px 20px rgba(40,30,60,.07);--shadow-lg:0 24px 64px rgba(30,20,50,.24);--row-btn-bg:var(--accent);--row-btn-fg:var(--on-accent);--row-btn-bd:var(--accent);--secondary-bg:var(--surface-2);--backlog-bg:var(--amber-bg);--backlog-edge:0 0 0 transparent;--backlog-text:var(--amber);--card-highlight:0 0 0 transparent;color-scheme:light;"
FIXED_D = "--inverse-bg:var(--text);--inverse-text:var(--bg);--backdrop:rgba(4,4,14,.64);--shadow-sm:0 1px 2px rgba(0,0,0,.28);--shadow:0 1px 2px rgba(0,0,0,.22),0 6px 20px rgba(0,0,0,.2);--shadow-lg:0 24px 64px rgba(0,0,0,.5);--row-btn-bg:var(--accent);--row-btn-fg:var(--on-accent);--row-btn-bd:var(--accent);--secondary-bg:var(--surface-2);--backlog-bg:var(--amber-bg);--backlog-edge:0 0 0 transparent;--backlog-text:var(--amber);--card-highlight:inset 0 1px 0 rgba(255,255,255,.06);color-scheme:dark;"
HL = ['#A84E2F', '#2F6B45', '#3F5A9A', '#8A5A12', '#7A4890', '#27697A', '#A13F5C', '#5C5C45']
HD = ['#EBA083', '#8CC9A0', '#9DB4EC', '#E3BC6A', '#C9A0DC', '#82C4D1', '#E39AB0', '#BDBDA3']
def hues(cols, a, b):
    return ''.join(f'--h{i}-fg:{c};--h{i}-bg:color-mix(in srgb,{c} {a}%,var(--surface));--h{i}-bd:color-mix(in srgb,{c} {b}%,var(--surface));' for i, c in enumerate(cols))

KEYS = 'bg surface surface-2 surface-hover sunken border border-strong text text-2 text-3 accent accent-hover accent-soft accent-text on-accent success success-bg amber amber-bg amber-line amber-row danger danger-bg user-g-bg user-g-fg user-i-bg user-i-fg ring bg-art'.split()

def T(*vals):
    assert len(vals) == len(KEYS), (len(vals), len(KEYS))
    return dict(zip(KEYS, vals))

THEMES = {
  'mango': dict(name='Mango',
    light=T('#FFF8E6', '#FFFFFF', '#FFEFC8', '#FFFBF1', '#FFFFFF', '#F4E0B0', '#E8C77E', '#2A2008', '#65522A', '#7A653A',
            '#FFB020', '#F5A000', '#FFE7A8', '#935600', '#2A1A00', '#10744B', '#DCF3E5', '#8C5300', '#FFE6C2', '#EDC27A', '#FFF0D9',
            '#B3261E', '#FDE3E0', '#FFDCCB', '#A63E12', '#D8E6FF', '#1F5CA8', 'rgba(255,176,32,.38)',
            'radial-gradient(900px 520px at 6% -8%,rgba(255,190,40,.30),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(255,120,80,.16),transparent 70%)'),
    dark=T('#151A2E', '#1E243C', '#283050', '#232A45', '#10142A', '#313A5C', '#434E76', '#F7F3E8', '#CDCBDD', '#A2A3BD',
           '#FFB627', '#FFC655', '#47391C', '#FFCD6B', '#2A1A00', '#6EE7A8', '#1C3A33', '#FFD166', '#3A3424', '#6B5832', '#25263A',
           '#FF8A80', '#4A2430', '#55301F', '#FFB38F', '#1F3D66', '#A4CCFF', 'rgba(255,182,39,.42)',
           'radial-gradient(900px 520px at 6% -8%,rgba(255,182,39,.15),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(120,110,255,.16),transparent 70%)')),
  'lime': dict(name='Lime',
    light=T('#F5FAE8', '#FFFFFF', '#EAF4D2', '#FAFDF2', '#FFFFFF', '#DCEABB', '#C2DA8C', '#18220A', '#4A5933', '#5F6F45',
            '#8BD11A', '#7DC00E', '#E2F5BE', '#3F6E08', '#162200', '#11744C', '#DCF3E5', '#8A5600', '#FFEECB', '#EECB82', '#FFF6DE',
            '#B42D2D', '#FCE2E0', '#FFDECF', '#A4401A', '#D4E9F8', '#1C6396', 'rgba(139,209,26,.38)',
            'radial-gradient(900px 520px at 4% -10%,rgba(160,225,40,.30),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(40,200,170,.14),transparent 70%)'),
    dark=T('#121514', '#1A1F1D', '#232A27', '#1F2522', '#0D100F', '#2C3430', '#3C4741', '#F1F6EC', '#C3CCC1', '#98A396',
           '#A8EA3C', '#BCF162', '#2F4318', '#C2F07A', '#142000', '#6EE7A8', '#1B3A2D', '#FFCF5C', '#37321F', '#5E542E', '#1E2320',
           '#FF8C85', '#46262A', '#55311F', '#FFB792', '#1C3E58', '#9DD1F7', 'rgba(168,234,60,.4)',
           'radial-gradient(900px 520px at 4% -10%,rgba(168,234,60,.12),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(30,210,180,.10),transparent 70%)')),
  'ocean': dict(name='Ocean',
    light=T('#EEF5FF', '#FFFFFF', '#E0EBFC', '#F5F9FF', '#FFFFFF', '#D0E0F5', '#B0C8EA', '#0F1E33', '#41536D', '#56698A',
            '#1E6AE1', '#1658C4', '#DCE8FF', '#1A5CC6', '#FFFFFF', '#0E7A55', '#DAF3E8', '#8D5500', '#FFEFCF', '#EFCF89', '#FFF7E4',
            '#B42B3D', '#FCE2E6', '#FFE0D2', '#A8401C', '#D5F1F8', '#0F6A82', 'rgba(30,106,225,.3)',
            'radial-gradient(900px 520px at 6% -8%,rgba(60,140,255,.22),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(0,200,220,.16),transparent 70%)'),
    dark=T('#0A1527', '#101F37', '#172A46', '#142540', '#07101E', '#1E3455', '#2B466E', '#EAF2FF', '#B2C4DF', '#869BBB',
           '#5AA9FF', '#7DBBFF', '#163961', '#9CCBFF', '#04172E', '#5EE0B0', '#123A35', '#FFC75A', '#33301F', '#5C522E', '#132139',
           '#FF8C9A', '#43213A', '#51301F', '#FFB592', '#123F4E', '#86E1F5', 'rgba(90,169,255,.4)',
           'radial-gradient(900px 520px at 6% -8%,rgba(90,169,255,.16),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(0,210,230,.10),transparent 70%)')),
  'flamingo': dict(name='Flamingo',
    light=T('#FFF1F5', '#FFFFFF', '#FFE3EC', '#FFF7FA', '#FFFFFF', '#F6D2DE', '#ECB0C4', '#2E1420', '#6D4357', '#875B70',
            '#D6336C', '#BE2A5D', '#FFDCE8', '#B32A5A', '#FFFFFF', '#127552', '#DCF3E8', '#8C5600', '#FFEFCF', '#F0D08A', '#FFF7E3',
            '#B42318', '#FDE4DF', '#FFDDEA', '#A92A5B', '#D5ECFA', '#16689A', 'rgba(214,51,108,.3)',
            'radial-gradient(900px 520px at 6% -8%,rgba(255,110,165,.22),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(255,175,110,.18),transparent 70%)'),
    dark=T('#21111B', '#2D1725', '#391F30', '#331B2B', '#190C14', '#49293D', '#60374F', '#FFF0F5', '#E1C1D0', '#B794A6',
           '#FF6FA5', '#FF8DB8', '#5A2341', '#FFA8C9', '#33081B', '#6EE7B0', '#1F3A30', '#FFC960', '#3D2F25', '#6A5030', '#2B1923',
           '#FF9580', '#4C2424', '#5C2442', '#FFB0CF', '#1D3F5A', '#9DD3FA', 'rgba(255,111,165,.4)',
           'radial-gradient(900px 520px at 6% -8%,rgba(255,111,165,.14),transparent 70%),radial-gradient(760px 480px at 100% 0%,rgba(255,150,90,.09),transparent 70%)')),
  'aurora': dict(name='Aurora',
    light=T('#F5F4FF', '#FFFFFF', '#EEEAFC', '#FAF9FF', '#FFFFFF', '#E0DBF5', '#C9BFEB', '#1C1633', '#534A75', '#6A628E',
            '#A21CAF', '#8B1696', '#F7DDFA', '#8E1A99', '#FFFFFF', '#0E7556', '#D9F4EA', '#8A5600', '#FFF0CC', '#EED28C', '#FFF8E6',
            '#B42340', '#FCE1E7', '#FFDCEB', '#B0276B', '#D2F1EC', '#0D6C62', 'rgba(162,28,175,.28)',
            'radial-gradient(900px 520px at 4% -10%,rgba(60,220,170,.24),transparent 70%),radial-gradient(820px 520px at 100% 0%,rgba(190,90,255,.20),transparent 70%)'),
    dark=T('#0B0F22', '#141A33', '#1D2442', '#18203B', '#080B19', '#272F52', '#363F68', '#F3F1FF', '#C6C3E6', '#9A98C2',
           '#E879F9', '#F09CFB', '#4A2163', '#F3A9FC', '#2A0633', '#5EEBB8', '#123B3A', '#FFD166', '#34301F', '#5E552F', '#161B33',
           '#FF8AA6', '#46203A', '#5A2848', '#FFB3D9', '#103F43', '#7FEAD8', 'rgba(232,121,249,.42)',
           'radial-gradient(900px 560px at 4% -10%,rgba(52,227,176,.16),transparent 70%),radial-gradient(820px 560px at 100% 0%,rgba(190,90,255,.20),transparent 70%)')),
}

def lum(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)
def cr(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + .05) / (y + .05)

PAIRS = [('text', 'bg', 4.5), ('text', 'surface-2', 4.5), ('text-2', 'bg', 4.5), ('text-2', 'surface', 4.5), ('text-2', 'surface-2', 4.5),
         ('text-3', 'bg', 4.5), ('text-3', 'surface', 4.5), ('text-3', 'surface-2', 4.0),
         ('on-accent', 'accent', 4.5), ('on-accent', 'accent-hover', 4.5), ('accent-text', 'surface', 4.5), ('accent-text', 'bg', 4.5), ('accent-text', 'accent-soft', 4.5),
         ('success', 'success-bg', 4.5), ('success', 'surface', 4.5), ('amber', 'amber-bg', 4.5), ('amber', 'amber-row', 4.5), ('text', 'amber-row', 4.5), ('text-2', 'amber-row', 4.5),
         ('danger', 'danger-bg', 4.5), ('danger', 'surface', 4.5), ('user-g-fg', 'user-g-bg', 4.5), ('user-i-fg', 'user-i-bg', 4.5)]

fail = 0
for tid, t in THEMES.items():
    for mode in ('light', 'dark'):
        v = t[mode]
        for a, b, need in PAIRS:
            c = cr(v[a], v[b])
            if c < need:
                fail += 1; print(f'FAIL {tid}/{mode}: {a} on {b} = {c:.2f} (need {need})')
        # the on-hold row must look different from a normal row
        if cr(v['amber-row'], v['surface']) < 1.03: print(f'WARN {tid}/{mode}: hold row too close to surface ({cr(v["amber-row"], v["surface"]):.3f})')

def block(v, dark):
    body = ''.join(f'--{k}:{v[k]};' for k in KEYS)
    return body + (FIXED_D + hues(HD, 16, 32) if dark else FIXED_L + hues(HL, 13, 26))

out = ['/* ---- New themes (generated by gen.py; contrast-checked) ---- */']
for tid, t in THEMES.items():
    sel = f':root[data-palette="{tid}"]'
    out.append(f'{sel}{{{block(t["light"], False)}}}')
    out.append(f'@media (prefers-color-scheme: dark){{{sel}:not([data-theme="light"]){{{block(t["dark"], True)}}}}}')
    out.append(f'{sel}[data-theme="dark"]{{{block(t["dark"], True)}}}')
out.append('/* ---- end new themes ---- */')

if '--check' in sys.argv:
    sys.exit(1 if fail else 0)
path = sys.argv[1]
css = open(path).read()
css = re.sub(r'\n?/\* ---- New themes.*?end new themes ---- \*/\n?', '\n', css, flags=re.S).rstrip('\n') + '\n'
open(path, 'w').write(css + '\n'.join(out) + '\n')
# JS swatches: [bg, surface, accent] for each mode
for tid, t in THEMES.items():
    L, D = t['light'], t['dark']
    print(f"  {{ id: '{tid}', name: '{t['name']}', light: ['{L['bg']}', '{L['surface']}', '{L['accent']}'], dark: ['{D['bg']}', '{D['surface']}', '{D['accent']}'] }},")
print('fails:', fail)
