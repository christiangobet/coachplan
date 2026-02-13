#!/usr/bin/env python3
import argparse
import json
import os
import re
from datetime import datetime

import pdfplumber

DAY_KEYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
HEADER_ROW = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']
HEADER_ROW_WITH_WEEK = ['WEEK'] + HEADER_ROW
HEADER_ROW_WITH_WEEK_TWM = ['WEEK'] + HEADER_ROW + ['TWM']

DISTANCE_RE = re.compile(
    r'(?P<val>\d+(?:\.\d+)?)\s*(?P<unit>miles?|mile|mi|kms?|kilometers?|kilometres?|meters?|metres?|m)\b',
    re.I
)
DISTANCE_RANGE_RE = re.compile(
    r'(?P<v1>\d+(?:\.\d+)?)\s*[\u2013-]\s*(?P<v2>\d+(?:\.\d+)?)\s*(?P<unit>miles?|mile|mi|kms?|kilometers?|kilometres?|meters?|metres?|m)\b',
    re.I
)
MIN_RE = re.compile(r'(?P<min>\d+)\s*(?:minutes?|mins?|min|m)\b')
RANGE_MIN_RE = re.compile(r'(?P<min1>\d+)\s*[\u2013-]\s*(?P<min2>\d+)\s*(?:minutes?|mins?|m\b)')

SEGMENT_RULES = [
    ('strength', re.compile(r'^strength\s*\d+', re.I)),
    ('rest', re.compile(r'\brest day\b', re.I)),
    ('cross-training', re.compile(r'cross training', re.I)),
    ('training-race', re.compile(r'training race', re.I)),
    ('race', re.compile(r'\brace\b', re.I)),
    ('incline-treadmill', re.compile(r'incline treadmill', re.I)),
    ('hill-pyramid', re.compile(r'hill pyramid', re.I)),
    ('hills', re.compile(r'\bhills\b', re.I)),
    ('tempo', re.compile(r'tempo', re.I)),
    ('progression', re.compile(r'progres', re.I)),
    ('recovery', re.compile(r'recovery', re.I)),
    ('trail-run', re.compile(r'\btrail\b', re.I)),
    ('fast-finish', re.compile(r'fast finish', re.I)),
    ('lrl', re.compile(r'\bLRL\b', re.I)),
    ('hike', re.compile(r'\bhike\b', re.I)),
    ('easy-run', re.compile(r'\beasy\b', re.I)),
]

TYPE_PRIORITY = [
    'rest','race','training-race','strength','tempo','hills','hill-pyramid',
    'incline-treadmill','progression','trail-run','recovery','easy-run',
    'cross-training','hike','lrl','fast-finish','unknown'
]


def normalize_text(text):
    return re.sub(r'\s+', ' ', text or '').strip()

def strip_footnotes(text):
    # Remove trailing footnote digits attached to words (e.g., miles2, XT3, LR6)
    return re.sub(r'(?<=[A-Za-z])\d+', '', text)

def clean_cell_text(text):
    t = normalize_text(strip_footnotes((text or '').replace('\n', ' ')))
    if not t:
        return t
    if t.lower().startswith('est;'):
        t = 'Rest;' + t[4:]
    # Fix split words like "iles" -> "miles"
    t = re.sub(r'(?<=\d)\s*iles\b', ' miles', t)
    # Remove stray "R" after star footnotes (e.g., "★4 R 1-2 mile WU")
    t = re.sub(r'★\s*\d+\s*R\s+', '★ ', t)
    return t


def normalize_distance_unit(raw_unit, value, full_text):
    u = (raw_unit or '').strip().lower()
    if u in ('mile', 'miles', 'mi'):
        return 'miles'
    if u in ('km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'):
        return 'km'
    if u in ('meter', 'meters', 'metre', 'metres'):
        return 'm'
    if u == 'm':
        if value >= 100:
            return 'm'
        # For short "m" values, prefer minutes unless interval/rep context strongly suggests meters.
        meter_context = re.search(r'(\bx\b|\breps?\b|\bstrides?\b|\binterval\b)', full_text, re.I)
        return 'm' if meter_context else None
    return None


def to_km(value, unit):
    if value is None:
        return None
    if unit == 'km':
        return float(value)
    if unit == 'm':
        return float(value) / 1000.0
    return None


def parse_metrics(text):
    t = text.lower()
    miles = None
    miles_range = None
    km = None
    km_range = None
    meters = None
    meters_range = None
    distance_value = None
    distance_unit = None
    distance_range = None
    mins = None
    mins_range = None

    rm = DISTANCE_RANGE_RE.search(t)
    text_without_distance = t
    if rm:
        v1 = float(rm.group('v1'))
        v2 = float(rm.group('v2'))
        unit = normalize_distance_unit(rm.group('unit'), max(v1, v2), t)
        if unit:
            distance_range = [v1, v2]
            distance_unit = unit
            distance_value = v2
            if unit == 'miles':
                miles_range = [v1, v2]
                miles = v2
            elif unit == 'km':
                km_range = [v1, v2]
                km = v2
            elif unit == 'm':
                meters_range = [v1, v2]
                meters = v2
                km_range = [round(v1 / 1000.0, 4), round(v2 / 1000.0, 4)]
                km = round(v2 / 1000.0, 4)
            text_without_distance = DISTANCE_RANGE_RE.sub('', text_without_distance, count=1)
    else:
        m = DISTANCE_RE.search(t)
        if m:
            value = float(m.group('val'))
            unit = normalize_distance_unit(m.group('unit'), value, t)
            if unit:
                distance_value = value
                distance_unit = unit
                if unit == 'miles':
                    miles = value
                elif unit == 'km':
                    km = value
                elif unit == 'm':
                    meters = value
                    km = round(value / 1000.0, 4)
                text_without_distance = DISTANCE_RE.sub('', text_without_distance, count=1)

    rmin = RANGE_MIN_RE.search(text_without_distance)
    if rmin:
        mins_range = [int(rmin.group('min1')), int(rmin.group('min2'))]
    else:
        mn = MIN_RE.search(text_without_distance)
        if mn:
            mins = int(mn.group('min'))

    return {
        'distance_value': distance_value,
        'distance_unit': distance_unit,
        'distance_range': distance_range,
        'distance_miles': miles,
        'distance_miles_range': miles_range,
        'distance_km': km,
        'distance_km_range': km_range,
        'distance_meters': meters,
        'distance_meters_range': meters_range,
        'duration_minutes': mins,
        'duration_minutes_range': mins_range,
    }


def classify_segment(seg):
    for t, rx in SEGMENT_RULES:
        if rx.search(seg):
            return t
    return 'unknown'


def parse_cell(cell_text):
    raw = clean_cell_text(cell_text)
    if not raw:
        return {
            'raw': '',
            'segments': [],
            'segments_parsed': [],
            'type_guess': 'unknown',
            'metrics': {}
        }

    segments = [normalize_text(s) for s in re.split(r'\s*\+\s*', raw) if normalize_text(s)]
    segments_parsed = []
    found = set()
    for s in segments:
        t = classify_segment(s)
        found.add(t)
        segments_parsed.append({
            'text': s,
            'type': t,
            'metrics': parse_metrics(s)
        })

    type_guess = 'unknown'
    for t in TYPE_PRIORITY:
        if t in found:
            type_guess = t
            break

    return {
        'raw': raw,
        'segments': segments,
        'segments_parsed': segments_parsed,
        'type_guess': type_guess,
        'metrics': parse_metrics(raw)
    }


def extract_tables(pdf):
    weeks = []

    line_settings = {
        'vertical_strategy': 'lines',
        'horizontal_strategy': 'lines',
        'intersection_tolerance': 5,
        'snap_tolerance': 3,
        'join_tolerance': 3,
        'edge_min_length': 3,
        'min_words_vertical': 1,
        'min_words_horizontal': 1,
    }

    text_settings = {
        'vertical_strategy': 'text',
        'horizontal_strategy': 'text',
        'intersection_tolerance': 5,
        'snap_tolerance': 3,
        'join_tolerance': 3,
        'edge_min_length': 3,
        'min_words_vertical': 3,
        'min_words_horizontal': 1,
    }

    def parse_table(table):
        nonlocal weeks
        if not table or len(table) < 2:
            return
        header = [normalize_text(h).upper() for h in table[0]]
        if header not in (HEADER_ROW, HEADER_ROW_WITH_WEEK, HEADER_ROW_WITH_WEEK_TWM):
            return

        current_week_num = None
        current_cells = None

        def flush_week():
            nonlocal current_week_num, current_cells
            if not current_week_num or not current_cells:
                return
            week = {'days': {}}
            for i, day in enumerate(DAY_KEYS):
                week['days'][day] = parse_cell(current_cells[i] or '')
            weeks.append(week)
            current_week_num = None
            current_cells = None

        rows = table[1:]
        for row in rows:
            row = [clean_cell_text(c) for c in row]
            if not row:
                continue
            if row[0].upper() == 'WEEK':
                continue

            # map columns to weekdays
            if header == HEADER_ROW:
                cells = (row + [''] * 7)[:7]
                # No WEEK column — each row is a complete week
                is_new_week = any(c.strip() for c in cells)
                week_marker = str(len(weeks) + 1) if is_new_week else ''
            elif header == HEADER_ROW_WITH_WEEK:
                week_marker = row[0]
                cells = (row[1:] + [''] * 7)[:7]
                is_new_week = str(week_marker).strip().isdigit()
            else:
                week_marker = row[0]
                cells = (row[1:8] + [''] * 7)[:7]
                is_new_week = str(week_marker).strip().isdigit()

            # start a new week row
            if is_new_week:
                flush_week()
                current_week_num = week_marker
                current_cells = cells
                continue

            # continuation row: append non-empty cells
            if current_cells is None:
                continue
            for i in range(7):
                if cells[i]:
                    if current_cells[i]:
                        current_cells[i] = f"{current_cells[i]} {cells[i]}".strip()
                    else:
                        current_cells[i] = cells[i]

        flush_week()

    for page in pdf.pages:
        before = len(weeks)
        line_tables = page.extract_tables(line_settings) or []
        for table in line_tables:
            parse_table(table)

        if len(weeks) == before:
            text_tables = page.extract_tables(text_settings) or []
            for table in text_tables:
                parse_table(table)

    return weeks


def extract_glossary(pdf):
    page = pdf.pages[-1]
    w = page.width
    h = page.height
    left = page.crop((0, 0, w * 0.5, h))
    right = page.crop((w * 0.5, 0, w, h))
    left_text = normalize_text(left.extract_text() or '')
    right_text = normalize_text(right.extract_text() or '')

    labels = [
        '4 x 30 second flat and fast',
        'Strength',
        'Easy',
        'Tempo',
        'Progression Run',
        'Hill Pyramid',
        'Incline Treadmill',
        'Hills',
        'Cross training',
        'Recovery run or hike',
        'Fast Finish',
        'LRL',
        'Training Race'
    ]

    label_pattern = '|'.join([re.escape(l) for l in labels])
    rx = re.compile(r'(' + label_pattern + r')\s*:\s*', re.IGNORECASE)

    def parse_column(text):
        entries = {}
        matches = list(rx.finditer(text))
        for i, m in enumerate(matches):
            label = m.group(1)
            start = m.end()
            end = matches[i+1].start() if i+1 < len(matches) else len(text)
            definition = text[start:end].strip()
            disclaimer_idx = definition.lower().find('disclaimer:')
            if disclaimer_idx != -1:
                definition = definition[:disclaimer_idx].strip()
            definition = re.sub(r'\s+', ' ', definition).strip(' -;')
            entries[label.lower()] = definition
        return entries

    left_entries = parse_column(left_text)
    right_entries = parse_column(right_text)

    combined = {}
    review_needed = []
    for label in labels:
        key = label.lower()
        cand = []
        if key in left_entries:
            cand.append(left_entries[key])
        if key in right_entries:
            cand.append(right_entries[key])
        if not cand:
            continue
        best = max(cand, key=lambda s: len(s.split()))

        issues = []
        for other in labels:
            if other.lower() == key:
                continue
            if re.search(r'\b' + re.escape(other) + r'\b', best, re.IGNORECASE):
                issues.append('overlap_with_label:' + other)
        needs_review = len(issues) > 0
        if needs_review:
            review_needed.append(label)

        combined[key] = {
            'title': label,
            'definition': best,
            'section': None,
            'needs_review': needs_review,
            'issues': issues
        }

    return {
        'sections': [],
        'entries': combined,
        'review_needed': review_needed,
        'note': 'Glossary extracted from a multi-column PDF; some entries may need manual review.'
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--name', default='Training Plan')
    args = parser.parse_args()

    with pdfplumber.open(args.input) as pdf:
        weeks = extract_tables(pdf)
        glossary = extract_glossary(pdf)

    plan = {
        'source_pdf': os.path.basename(args.input),
        'program_name': args.name,
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'weeks': [],
        'glossary': glossary
    }

    for i, week in enumerate(weeks, start=1):
        week_entry = {'week_number': i, 'days': week['days']}
        plan['weeks'].append(week_entry)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w') as f:
        json.dump(plan, f, indent=2)


if __name__ == '__main__':
    main()
