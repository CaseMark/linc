// Fixed host code, not a caller script. -I -S isolates Python from workspace
// imports, site hooks, and PYTHON* settings. Only bounded JSON data enters stdin.
export const TEMPLATE_FILL_PROGRAM = String.raw`
import base64, io, json, re, resource, sys, zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, unescape

resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
if sys.platform == 'linux':
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
LIMIT = 16 * 1024 * 1024
PART_LIMIT = 8 * 1024 * 1024
WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'

def fail(message):
    raise ValueError(message)

def plain_text(value):
    for ch in value:
        n = ord(ch)
        if not (n in (9, 10, 13) or 32 <= n <= 0xd7ff or 0xe000 <= n <= 0xfffd or 0x10000 <= n <= 0x10ffff):
            fail('Invalid XML character in template value')
    return escape(value).replace('\r\n', '\n').replace('\r', '\n').replace('\n', '</w:t><w:br/><w:t xml:space="preserve">').replace('\t', '</w:t><w:tab/><w:t xml:space="preserve">')

def fill_paragraph(match, values, used):
    paragraph = match.group(0)
    if len(re.findall(r'<w:p\b', paragraph)) != 1:
        fail('Nested template paragraphs are unsupported')
    nodes = list(re.finditer(r'(<w:t\b[^>]*>)([^<]*)(</w:t>)', paragraph))
    texts = [unescape(n.group(2), {'&quot;': '"', '&apos;': "'"}) for n in nodes]
    combined = ''.join(texts)
    # No Jinja, code, filters, loops, attributes, or expression evaluation.
    if '{%' in combined or '{#' in combined:
        fail('Template control expressions are unsupported')
    placeholders = list(re.finditer(r'\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}', combined))
    remainder = re.sub(r'\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}', '', combined)
    if '{{' in remainder or '}}' in remainder:
        fail('Only literal {{field}} template placeholders are supported')
    offsets = []
    pos = 0
    for text in texts:
        offsets.append(pos)
        pos += len(text)
    # Reverse order keeps original offsets valid. Keep the starting run's style;
    # remove only the placeholder's text from any subsequent split runs.
    for placeholder in reversed(placeholders):
        key = placeholder.group(1)
        if key not in values:
            fail('Missing template value: ' + key)
        used[key] = used.get(key, 0) + 1
        start, end = placeholder.span()
        first = next(i for i, offset in enumerate(offsets) if offset <= start < offset + len(texts[i]))
        last = next(i for i, offset in enumerate(offsets) if offset < end <= offset + len(texts[i]))
        a, b = start - offsets[first], end - offsets[last]
        if first == last:
            texts[first] = texts[first][:a] + values[key] + texts[first][b:]
        else:
            texts[first] = texts[first][:a] + values[key]
            for i in range(first + 1, last):
                texts[i] = ''
            texts[last] = texts[last][b:]
    for node, text in reversed(list(zip(nodes, texts))):
        if text == unescape(node.group(2), {'&quot;': '"', '&apos;': "'"}):
            continue
        replacement = re.sub(r'\s+xml:space=["\'][^"\']*["\']', '', node.group(1))[:-1] + ' xml:space="preserve">' + plain_text(text) + node.group(3)
        paragraph = paragraph[:node.start()] + replacement + paragraph[node.end():]
    return paragraph

try:
    request = json.loads(sys.stdin.buffer.read(24 * 1024 * 1024 + 1))
    raw = base64.b64decode(request['template'], validate=True)
    if len(raw) > LIMIT:
        fail('Template exceeds file size limit')
    values = request['values']
    if not isinstance(values, dict) or not 1 <= len(values) <= 128:
        fail('Invalid template values')
    for key, value in values.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', key) or not isinstance(value, str) or len(value) > 16384:
            fail('Invalid template value')
        plain_text(value)
    if sum(len(v.encode('utf-8')) for v in values.values()) > 262144:
        fail('Template values exceed text budget')
    parts = []
    seen = set()
    used = {}
    total = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        entries = source.infolist()
        if not 1 <= len(entries) <= 512:
            fail('Template exceeds part count limit')
        for entry in entries:
            name = entry.filename
            if name in seen or not name or '\\' in name or name.startswith('/') or any(s in ('.', '..', '') for s in name.split('/')):
                fail('Unsafe or duplicate template part')
            seen.add(name)
            if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                fail('Unsupported encrypted or compressed template')
            if entry.file_size > PART_LIMIT or total + entry.file_size > 32 * 1024 * 1024:
                fail('Template exceeds decompressed size limit')
            if name.lower().endswith(('.bin', '.exe', '.dll', '.js', '.py', '.vbs')) or name.startswith(('word/embeddings/', 'word/activeX/')):
                fail('Active or embedded template content is unsupported')
            with source.open(entry) as stream:
                data = stream.read(PART_LIMIT + 1)
            if len(data) != entry.file_size or len(data) > PART_LIMIT:
                fail('Template part exceeds decompressed size limit')
            total += len(data)
            if name.endswith(('.xml', '.rels')):
                xml = data.decode('utf-8')
                if '<!' in xml or re.search(r'<\?(?!xml\s)', xml):
                    fail('Template XML declarations are unsupported')
                root = ET.fromstring(xml)
                if name.endswith('.rels'):
                    for relationship in root.iter('{' + RELS + '}Relationship'):
                        if relationship.get('TargetMode', '').lower() == 'external':
                            fail('External template relationships are unsupported')
                if any(n.tag in ('{' + WORD + '}instrText', '{' + WORD + '}fldSimple', '{' + WORD + '}object', '{' + WORD + '}altChunk') for n in root.iter()):
                    fail('Active template fields are unsupported')
                if 'macroEnabled' in xml or 'vbaProject' in xml:
                    fail('Template macros are unsupported')
                is_fill_part = name == 'word/document.xml' or re.fullmatch(r'word/(header|footer)\d+\.xml', name)
                if is_fill_part:
                    if root.tag not in ('{' + WORD + '}document', '{' + WORD + '}hdr', '{' + WORD + '}ftr') or not re.search(r'xmlns:w=["\']' + re.escape(WORD) + r'["\']', xml):
                        fail('Unsupported template Word namespace')
                    original_text = ''.join(root.itertext())
                    field_pattern = r'\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}'
                    expected = len(re.findall(field_pattern, original_text))
                    remainder = re.sub(field_pattern, '', original_text)
                    if any(t in remainder for t in ('{{', '}}', '{%', '{#')):
                        fail('Unsupported template placeholder')
                    before = sum(used.values())
                    xml = re.sub(r'<w:p\b[^>]*>[\s\S]*?</w:p>', lambda m: fill_paragraph(m, values, used), xml)
                    if sum(used.values()) - before != expected:
                        fail('Unfilled or unsupported template placeholder')
                    ET.fromstring(xml)
                    data = xml.encode('utf-8')
                # Refuse silently untouched placeholders in other parts/namespaces.
                all_text = ''.join(ET.fromstring(data).itertext())
                if not is_fill_part and name not in ('docProps/core.xml', 'docProps/app.xml') and any(t in all_text for t in ('{{', '}}', '{%', '{#')):
                    fail('Unfilled or unsupported template placeholder')
            parts.append((name, data))
    if '[Content_Types].xml' not in seen or 'word/document.xml' not in seen:
        fail('Not a Word template package')
    if set(used) != set(values):
        fail('Unused template values: ' + ', '.join(sorted(set(values) - set(used))))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as destination:
        for name, data in parts:
            destination.writestr(name, data)
    result = output.getvalue()
    if len(result) > LIMIT:
        fail('Filled template exceeds file size limit')
    sys.stdout.write(json.dumps({'document': base64.b64encode(result).decode('ascii'), 'fields': sorted(used)}))
except Exception as error:
    sys.stderr.write(str(error)[:400])
    sys.exit(1)
`;
