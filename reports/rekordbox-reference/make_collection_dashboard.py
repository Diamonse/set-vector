"""Create a self-contained local browser view of the Rekordbox collection."""
from collections import Counter
import json
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET

ROOT = Path(r"C:\Users\aryan\.codex\visualizations\2026\09\24\01a0d420-275a-7470-9a77-be651ed71970")
XML = Path(r"C:\Users\aryan\Downloads\Rekordbox\collection_1.xml")
OUTPUT = ROOT / "rekordbox-collection.html"


def make_data():
    root = ET.parse(XML).getroot()
    tracks = []
    for track in root.findall("./COLLECTION/TRACK"):
        attributes = dict(track.attrib)
        uri = urlparse(attributes.get("Location", ""))
        audio = Path(unquote(uri.path).lstrip("/"))
        kind = attributes.get("Kind", "")
        group = "Sample" if kind == "WAV File" else "Missing audio" if not audio.is_file() else "Song"
        tracks.append({
            "id": attributes.get("TrackID", ""),
            "name": attributes.get("Name", ""),
            "artist": attributes.get("Artist", ""),
            "album": attributes.get("Album", ""),
            "genre": attributes.get("Genre", ""),
            "key": attributes.get("Tonality", ""),
            "bpm": attributes.get("AverageBpm", ""),
            "duration": int(attributes.get("TotalTime", "0") or 0),
            "group": group,
            "markers": [dict(marker.attrib) for marker in track.findall("TEMPO")],
            "cues": [dict(cue.attrib) for cue in track.findall("POSITION_MARK")],
            "attributes": attributes,
            "audio_exists": audio.is_file(),
        })
    return {
        "version": root.find("PRODUCT").get("Version", ""),
        "tracks": tracks,
        "summary": {
            "total": len(tracks),
            "songs": sum(t["group"] == "Song" for t in tracks),
            "samples": sum(t["group"] == "Sample" for t in tracks),
            "missing": sum(t["group"] == "Missing audio" for t in tracks),
            "markers": sum(len(t["markers"]) for t in tracks),
            "cues": sum(len(t["cues"]) for t in tracks),
            "genres": Counter(t["genre"] or "Unspecified" for t in tracks if t["group"] == "Song").most_common(),
        },
    }


HTML = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rekordbox collection · all tracks</title>
<style>
:root{color-scheme:dark;--bg:#081421;--surface:#11263a;--surface2:#183248;--line:#355369;--ink:#eff8fb;--muted:#abc1ce;--mint:#6de4c6;--amber:#f8c27b;--red:#f2938c}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#153d50,transparent 36%),var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,sans-serif}main{max-width:1440px;margin:auto;padding:30px 32px 70px}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(34px,4.7vw,58px);line-height:1.05;letter-spacing:-.045em;margin:7px 0 12px}h2{font-size:22px;letter-spacing:-.02em;margin-bottom:7px}.eyebrow{color:var(--mint);letter-spacing:.16em;font-size:12px;font-weight:750;text-transform:uppercase}.lead{color:var(--muted);font-size:17px;max-width:820px}.subtle{color:var(--muted);font-size:13px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:26px 0}.card,.panel{background:linear-gradient(150deg,#173148,#102236);border:1px solid var(--line);border-radius:16px}.card{padding:17px 19px}.card strong{font-size:32px;display:block;line-height:1.15}.card span{color:var(--muted);font-size:13px}.panel{padding:22px;margin:15px 0}.columns{display:grid;grid-template-columns:1.25fr 1fr;gap:15px}.columns .panel{margin:0}.bar{display:grid;grid-template-columns:150px 1fr 38px;gap:10px;align-items:center;margin:8px 0}.bar label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:9px;background:#0a1c2a;border-radius:9px;overflow:hidden}.bar-fill{height:100%;background:var(--mint);border-radius:9px}.bar b{text-align:right;font-weight:500;color:var(--muted)}.chip{display:inline-block;border:1px solid #4b6a7c;background:#142b40;padding:3px 9px;border-radius:99px;font-size:12px;white-space:nowrap}.chip.song{color:var(--mint)}.chip.sample{color:var(--amber)}.chip.missing{color:var(--red)}.controls{display:grid;grid-template-columns:minmax(250px,2fr) repeat(3,minmax(130px,1fr));gap:10px;margin:17px 0}input,select{width:100%;border:1px solid #48677b;background:#0b2032;color:var(--ink);font:inherit;border-radius:9px;padding:10px 12px}input:focus,select:focus,button:focus-visible{outline:2px solid var(--mint);outline-offset:2px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;min-width:860px}th{text-align:left;color:#a7c0d0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;background:#0e2436;position:sticky;top:0}th,td{padding:10px 11px;border-bottom:1px solid #2c485d}td{vertical-align:top}tr:last-child td{border-bottom:0}tbody tr:hover,tbody tr.selected{background:#1a3a4c}button.row{border:0;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer;padding:0;font-weight:650}button.row:hover{text-decoration:underline}.title-sub{color:var(--muted);font-size:12px}.numeric{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}.detail{display:none}.detail.open{display:block}.detail-head{display:flex;justify-content:space-between;gap:14px}.detail h3{font-size:23px;margin-bottom:3px}.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:18px 0}.fact{background:#0c2234;border:1px solid #304e63;border-radius:10px;padding:9px 12px;min-width:0}.fact b{display:block;overflow-wrap:anywhere}.fact span{font-size:12px;color:var(--muted)}.metadata{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metadata div{background:#0b2032;padding:7px 10px;border-radius:8px;overflow-wrap:anywhere}.metadata dt{font-size:11px;color:var(--muted)}.metadata dd{margin:0;font-size:13px}.markers{max-height:250px;overflow:auto;border:1px solid #315066;border-radius:9px;margin-top:8px}.markers table{min-width:400px}.markers th{position:static}.close{background:#193b4b;color:var(--ink);border:1px solid #517487;border-radius:8px;padding:7px 11px;cursor:pointer;height:fit-content}.foot{font-size:12px;color:var(--muted);margin-top:14px}.empty{padding:28px;text-align:center;color:var(--muted)}
@media(max-width:1000px){.stats{grid-template-columns:repeat(3,1fr)}.columns{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:repeat(2,1fr)}.metadata{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){main{padding:20px 14px}.stats{grid-template-columns:repeat(2,1fr)}.controls{grid-template-columns:1fr}.detail-grid,.metadata{grid-template-columns:1fr}}
</style><style>
.detail{position:fixed;z-index:3;inset:12px 12px 12px auto;width:min(760px,calc(100vw - 24px));margin:0;overflow:auto;box-shadow:-18px 0 60px #0009}.detail-head{position:sticky;top:-22px;background:#142b40;padding:14px 0;z-index:1}@media(max-width:620px){.detail{inset:0;width:100vw;border-radius:0}}
</style></head><body><main>
<header><div class="eyebrow">Local Rekordbox XML · version <span id="version"></span></div><h1>Every track in the collection</h1><p class="lead">Search all song records, samples and unavailable files. Select a title to inspect its exported metadata, tempo markers and cues.</p><div class="subtle">Source: collection_1.xml · All rows below are XML records; duplicate titles remain separate.</div></header>
<section class="stats" id="stats" aria-label="Collection summary"></section>
<div class="columns"><section class="panel"><h2>Song genres</h2><p class="subtle">Among the 150 available full-length MP3 songs; blank genres are shown as unspecified.</p><div id="genres"></div></section><section class="panel"><h2>What the XML includes</h2><p>This export describes tracks with titles, artists, durations, BPM, key, genre, album, paths and other tags. Tempo markers define Rekordbox’s grids; the audio is stored separately.</p><p class="subtle" id="coverage"></p><p class="subtle">The 30 WAV files are short samples. Five full-length entries have paths to missing audio, so their XML details are visible but their sound cannot be analyzed here.</p></section></div>
<section class="panel" id="collection"><h2>Track list <span class="subtle" id="results"></span></h2><div class="controls"><input id="search" type="search" placeholder="Search title, artist, album, genre, key…" aria-label="Search tracks"><select id="group" aria-label="Filter by type"><option value="">All records</option><option>Song</option><option>Sample</option><option>Missing audio</option></select><select id="genre" aria-label="Filter by genre"><option value="">All genres</option></select><select id="sort" aria-label="Sort tracks"><option value="original">XML order</option><option value="title">Title A–Z</option><option value="artist">Artist A–Z</option><option value="duration">Longest first</option><option value="bpm">BPM low–high</option><option value="markers">Most grid markers</option></select></div><div class="table-wrap"><table><thead><tr><th style="width:38%">Title</th><th>Artist</th><th>Genre</th><th class="numeric">Length</th><th class="numeric">BPM</th><th class="numeric">Markers</th><th>Type</th></tr></thead><tbody id="rows"></tbody></table></div><p class="foot">Click a title for full XML attributes and its tempo/cue records. Empty values mean the export did not supply that metadata.</p></section>
<section class="panel detail" id="detail" aria-live="polite"><div class="detail-head"><div><div class="eyebrow">Track detail · XML record <span id="detail-id"></span></div><h3 id="detail-title"></h3><div class="subtle" id="detail-artist"></div></div><button type="button" class="close" id="close">Close</button></div><div class="detail-grid" id="facts"></div><h2>Tempo markers</h2><p class="subtle">Each marker anchors the Rekordbox beat grid at its time; one marker can describe a steady grid for the whole song.</p><div id="markers"></div><h2 style="margin-top:20px">Cue positions</h2><div id="cues"></div><details style="margin-top:20px"><summary>All exported TRACK attributes</summary><dl class="metadata" id="metadata"></dl></details></section>
<p class="foot">This view shows the contents of the XML and file availability. See the <a href="rekordbox-setvector-comparison.html" style="color:var(--mint)">SetVector comparison</a> for per-track beat-grid results.</p>
</main><script id="data" type="application/json">__DATA__</script><script>
(function(){'use strict';const data=JSON.parse(document.getElementById('data').textContent),tracks=data.tracks;const byId=id=>document.getElementById(id);function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function length(n){n=Number(n)||0;return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')}function label(v){return v?esc(v):'<span class="muted">—</span>'}function chip(group){return '<span class="chip '+(group==='Song'?'song':group==='Sample'?'sample':'missing')+'">'+esc(group)+'</span>'}
byId('version').textContent=data.version;byId('stats').innerHTML=[['total','XML track records'],['songs','available songs'],['samples','short WAV samples'],['missing','missing audio files'],['markers','tempo markers']].map(([key,title])=>'<div class="card"><strong>'+data.summary[key].toLocaleString()+'</strong><span>'+title+'</span></div>').join('');
let max=data.summary.genres[0][1];byId('genres').innerHTML=data.summary.genres.slice(0,8).map(([name,n])=>'<div class="bar"><label title="'+esc(name)+'">'+esc(name)+'</label><div class="bar-track"><div class="bar-fill" style="width:'+(100*n/max)+'%"></div></div><b>'+n+'</b></div>').join('');
let keys=['Artist','Album','Genre','Tonality','AverageBpm'];byId('coverage').textContent='Metadata coverage: '+keys.map(k=>k+' '+tracks.filter(t=>t.attributes[k]).length+'/'+tracks.length).join(' · ')+'. '+data.summary.cues+' cue records.';
const genres=[...new Set(tracks.map(t=>t.genre).filter(Boolean))].sort((a,b)=>a.localeCompare(b));for(const g of genres){let opt=document.createElement('option');opt.value=g;opt.textContent=g;byId('genre').appendChild(opt)}
function render(){let q=byId('search').value.trim().toLocaleLowerCase(),group=byId('group').value,genre=byId('genre').value,sort=byId('sort').value;let shown=tracks.filter(t=>(!group||t.group===group)&&(!genre||t.genre===genre)&&(!q||[t.name,t.artist,t.album,t.genre,t.key,t.id].join(' ').toLocaleLowerCase().includes(q)));if(sort==='title')shown.sort((a,b)=>a.name.localeCompare(b.name));if(sort==='artist')shown.sort((a,b)=>a.artist.localeCompare(b.artist)||a.name.localeCompare(b.name));if(sort==='duration')shown.sort((a,b)=>b.duration-a.duration);if(sort==='bpm')shown.sort((a,b)=>(parseFloat(a.bpm)||Infinity)-(parseFloat(b.bpm)||Infinity));if(sort==='markers')shown.sort((a,b)=>b.markers.length-a.markers.length);byId('results').textContent='· '+shown.length+' of '+tracks.length+' records';byId('rows').innerHTML=shown.length?shown.map(t=>'<tr data-id="'+esc(t.id)+'"><td><button class="row" type="button" data-id="'+esc(t.id)+'">'+esc(t.name||'(untitled)')+'</button>'+(t.album?'<div class="title-sub">'+esc(t.album)+'</div>':'')+'</td><td>'+label(t.artist)+'</td><td>'+label(t.genre)+'</td><td class="numeric">'+length(t.duration)+'</td><td class="numeric">'+label(t.bpm)+'</td><td class="numeric">'+t.markers.length+'</td><td>'+chip(t.group)+'</td></tr>').join(''):'<tr><td class="empty" colspan="7">No tracks match these filters.</td></tr>'}
function show(id){let t=tracks.find(x=>x.id===id);if(!t)return;byId('detail').classList.add('open');byId('detail-id').textContent=t.id;byId('detail-title').textContent=t.name||'(untitled)';byId('detail-artist').textContent=t.artist||'Artist not supplied';let facts=[['Type',t.group],['Length',length(t.duration)],['Average BPM',t.bpm||'—'],['Key',t.key||'—'],['Genre',t.genre||'—'],['Album',t.album||'—'],['Tempo markers',t.markers.length],['Audio file',t.audio_exists?'Available':'Unavailable']];byId('facts').innerHTML=facts.map(([k,v])=>'<div class="fact"><b>'+esc(v)+'</b><span>'+esc(k)+'</span></div>').join('');byId('markers').innerHTML=t.markers.length?'<div class="markers"><table><thead><tr><th>#</th><th>Time (s)</th><th>BPM</th><th>Meter</th><th>Beat in bar</th></tr></thead><tbody>'+t.markers.map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(m.Inizio)+'</td><td>'+esc(m.Bpm)+'</td><td>'+esc(m.Metro)+'</td><td>'+esc(m.Battito)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="subtle">No tempo markers in XML.</p>';byId('cues').innerHTML=t.cues.length?'<div class="markers"><table><thead><tr><th>#</th><th>Name</th><th>Time (s)</th><th>Type</th></tr></thead><tbody>'+t.cues.map((m,i)=>'<tr><td>'+(i+1)+'</td><td>'+label(m.Name)+'</td><td>'+label(m.Start)+'</td><td>'+label(m.Type)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="subtle">No cue positions in XML.</p>';byId('metadata').innerHTML=Object.entries(t.attributes).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+label(v)+'</dd></div>').join('');document.querySelectorAll('tbody tr.selected').forEach(x=>x.classList.remove('selected'));document.querySelector('tr[data-id="'+CSS.escape(id)+'"]')?.classList.add('selected');byId('detail').scrollIntoView({behavior:'smooth',block:'start'});history.replaceState(null,'','#track-'+encodeURIComponent(id))}
for(let id of ['search','group','genre','sort'])byId(id).addEventListener(id==='search'?'input':'change',render);byId('rows').addEventListener('click',e=>{let b=e.target.closest('button[data-id]');if(b)show(b.dataset.id)});byId('close').addEventListener('click',()=>{byId('detail').classList.remove('open');history.replaceState(null,'',location.pathname+location.search);byId('collection').scrollIntoView({behavior:'smooth'})});render();let initial=decodeURIComponent(location.hash.replace(/^#track-/,''));if(location.hash.startsWith('#track-')&&tracks.some(t=>t.id===initial))show(initial);
})();</script></body></html>'''


if __name__ == "__main__":
    data = make_data()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = HTML.replace("__DATA__", payload)
    html = html.replace("byId('detail').scrollIntoView({behavior:'smooth',block:'start'});", "byId('detail').scrollTop=0;")
    OUTPUT.write_text(html, encoding="utf-8")
    print(OUTPUT)
    print(f"records={data['summary']['total']} songs={data['summary']['songs']} samples={data['summary']['samples']} missing={data['summary']['missing']} bytes={OUTPUT.stat().st_size}")
