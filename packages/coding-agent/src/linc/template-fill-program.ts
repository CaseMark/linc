// Fixed host code, not a caller script. -I -S isolates Python from workspace
// imports, site hooks, and PYTHON* settings. Only bounded JSON data enters stdin.
export const TEMPLATE_FILL_PROGRAM = String.raw`
import base64, hashlib, io, json, os, re, resource, stat, sys, zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, unescape

resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
if sys.platform == 'linux':
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
LIMIT = 16 * 1024 * 1024
PART_LIMIT = 8 * 1024 * 1024
WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
BIB = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography'
DATASTORE = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml'
CUSTOM_PROPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps'

def fail(message):
    raise ValueError(message)

def read_regular(name, directory, budget):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > budget:
            fail('Unsafe or oversized template file')
        chunks = []
        total = 0
        while total <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        after = os.fstat(fd)
        if total != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
            fail('Template changed during read')
        return b''.join(chunks)
    finally:
        os.close(fd)

def read_template(slug):
    # Every directory is pinned by an FD before opening its child. A rename or
    # replacement symlink cannot redirect a later read to a different tree.
    directories = [os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
    try:
        for name in ('.pi', 'skills', 'using-document-templates'):
            directories.append(os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directories[-1]))
        root = directories[-1]
        references = os.open('references', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        directories.append(references)
        manifest = json.loads(read_regular('MANIFEST.json', references, 262144))
        if not isinstance(manifest, dict) or not isinstance(manifest.get('templates'), list):
            fail('Invalid injected template manifest')
        matches = [e for e in manifest['templates'] if isinstance(e, dict) and e.get('slug') == slug]
        if len(matches) != 1 or not isinstance(matches[0].get('templatePath'), str) or not re.fullmatch(r'assets/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.docx', matches[0]['templatePath']):
            fail('Template missing or unsafe in the injected org manifest')
        assets = os.open('assets', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        directories.append(assets)
        return read_regular(matches[0]['templatePath'].split('/')[1], assets, LIMIT)
    finally:
        for directory in reversed(directories):
            os.close(directory)

def allowed_part(name):
    return name in ('[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml') or bool(re.fullmatch(
        r'word/(document|styles|stylesWithEffects|numbering|settings|webSettings|fontTable|footnotes|endnotes|comments|commentsExtended|people)\.xml|word/(header|footer)\d+\.xml|word/theme/theme\d+\.xml|word/_rels/[A-Za-z0-9_.-]+\.rels|word/media/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|gif|bmp|tif|tiff)|docProps/thumbnail\.(png|jpg|jpeg)|customXml/(item1|itemProps1)\.xml|customXml/_rels/item1\.xml\.rels', name))

def validate_bibliography(name, root, groups):
    match = re.fullmatch(r'customXml/(item|itemProps)([1-9][0-9]*)\.xml|customXml/_rels/item([1-9][0-9]*)\.xml\.rels', name)
    kind = match.group(1) if match.group(1) else 'rels'
    index = match.group(2) or match.group(3)
    groups.setdefault(index, set()).add(kind)
    # Ordinary Word/python-docx templates carry an empty built-in APA Sources
    # part. This is not permission for arbitrary custom XML, populated source
    # data, stylesheet paths, or Word data bindings.
    if kind == 'item':
        if root.tag != '{' + BIB + '}Sources' or len(root) or (root.text or '').strip() or root.attrib != {'SelectedStyle': '/APA.XSL', 'StyleName': 'APA'}:
            fail('Unsupported custom XML bibliography')
    elif kind == 'itemProps':
        item_id = root.get('{' + DATASTORE + '}itemID', '')
        if root.tag != '{' + DATASTORE + '}datastoreItem' or set(root.attrib) != {'{' + DATASTORE + '}itemID'} or not re.fullmatch(r'\{[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\}', item_id) or len(root) != 1:
            fail('Unsupported custom XML properties')
        refs = root[0]
        if refs.tag != '{' + DATASTORE + '}schemaRefs' or refs.attrib or len(refs) != 1 or refs[0].tag != '{' + DATASTORE + '}schemaRef' or refs[0].attrib != {'{' + DATASTORE + '}uri': BIB} or len(refs[0]):
            fail('Unsupported custom XML schema')
        if any((node.text or '').strip() or (node.tail or '').strip() for node in root.iter()):
            fail('Unsupported custom XML property content')
    else:
        if root.tag != '{' + RELS + '}Relationships' or root.attrib or len(root) != 1:
            fail('Unsupported custom XML relationships')
        relationship = root[0]
        if relationship.tag != '{' + RELS + '}Relationship' or len(relationship) or set(relationship.attrib) != {'Id', 'Type', 'Target'} or not re.fullmatch(r'rId[1-9][0-9]*', relationship.get('Id', '')) or relationship.get('Type') != CUSTOM_PROPS or relationship.get('Target') != 'itemProps' + index + '.xml':
            fail('Unsupported custom XML relationship target')
        if any((node.text or '').strip() or (node.tail or '').strip() for node in root.iter()):
            fail('Unsupported custom XML relationship content')

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
    slug = request['templateSlug']
    if not isinstance(slug, str) or not 2 <= len(slug) <= 80 or not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', slug):
        fail('Invalid template slug')
    raw = read_template(slug)
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
    bibliography = {}
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
            if not allowed_part(name):
                fail('Unsupported or active template part')
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
                if name.startswith('customXml/'):
                    validate_bibliography(name, root, bibliography)
                if name.endswith('.rels'):
                    for relationship in root.iter('{' + RELS + '}Relationship'):
                        if relationship.get('TargetMode', '').lower() == 'external':
                            fail('External template relationships are unsupported')
                if any(n.tag in ('{' + WORD + '}' + tag for tag in ('instrText', 'fldSimple', 'fldChar', 'object', 'altChunk', 'dataBinding', 'customXml')) for n in root.iter()):
                    fail('Active template fields are unsupported')
                if any(token in xml.lower() for token in ('macroenabled', 'vbaproject', 'vbadata', 'oleobject', 'activex')):
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
    if any(kinds != {'item', 'itemProps', 'rels'} for kinds in bibliography.values()):
        fail('Incomplete custom XML bibliography package')
    if set(used) != set(values):
        fail('Unused template values: ' + ', '.join(sorted(set(values) - set(used))))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as destination:
        for name, data in parts:
            destination.writestr(name, data)
    result = output.getvalue()
    if len(result) > LIMIT:
        fail('Filled template exceeds file size limit')
    sys.stdout.write(json.dumps({'document': base64.b64encode(result).decode('ascii'), 'templateSha256': hashlib.sha256(raw).hexdigest()}))
except OSError:
    sys.stderr.write('Template file or directory is missing, inaccessible, or unsafe')
    sys.exit(1)
except Exception as error:
    sys.stderr.write(str(error)[:400])
    sys.exit(1)
`;
