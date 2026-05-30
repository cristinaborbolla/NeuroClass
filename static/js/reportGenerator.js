/**
 * NeuroClass — reportGenerator.js
 * Individual prediction report + evolution report.
 * Requires jsPDF loaded via CDN before this script.
 */

const _NC = {
  bg:        [246, 250, 245],
  surface:   [232, 242, 227],
  surface2:  [255, 255, 255],
  creamLt:   [250, 248, 242],
  cream:     [248, 243, 228],
  creamDk:   [243, 237, 218],
  border:    [183, 214, 176],
  matcha:    [148, 180, 159],
  matchaDk:  [110, 145, 120],
  matchaLt:  [183, 214, 176],
  matchaSlt: [211, 235, 206],
  dark:      [44,  62,  48],
  muted:     [122, 144, 128],
  light:     [246, 250, 245],
  white:     [255, 255, 255],
  stageNone: [107, 181, 107],
  stageVMild:[232, 195, 107],
  stageMild: [212, 141, 83],
  stageMod:  [207, 97, 97],
};

const _STAGE = {
  NonDemented:      { label:'Non-Demented',      short:'ND',  color:_NC.stageNone,  idx:0 },
  VeryMildDemented: { label:'Very Mild Demented', short:'VMD', color:_NC.stageVMild, idx:1 },
  MildDemented:     { label:'Mild Demented',       short:'MD',  color:_NC.stageMild,  idx:2 },
  ModerateDemented: { label:'Moderate Demented',   short:'MOD', color:_NC.stageMod,   idx:3 },
};
const _ORDER = ['NonDemented','VeryMildDemented','MildDemented','ModerateDemented'];

async function _loadImageAsBase64(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const rd = new FileReader();
      rd.onload  = () => resolve(rd.result);
      rd.onerror = () => resolve(null);
      rd.readAsDataURL(blob);
    });
  } catch(e) {
    console.warn('Image load failed:', url, e.message);
    return null;
  }
}

const _DOMAINS = [
  { key:'memory',       label:'Visual Memory',        game:'Memory'         },
  { key:'orientation',  label:'Temporal Orientation', game:'Orientation'    },
  { key:'sequence',     label:'Working Memory',       game:'Sequence'       },
  { key:'whatsmissing', label:'Visual Attention',     game:"What's Missing" },
  { key:'pattern',      label:'Visuospatial Memory',  game:'Pattern'        },
  { key:'arithmetic',   label:'Numerical Reasoning',  game:'Arithmetic'     },
];

function _fmt(d)   { return new Date(d||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function _fmtDT(d) { return new Date(d||Date.now()).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function _clamp(v) { return Math.min(1,Math.max(0,v||0)); }

function _computeDomains(sessions) {
  if (!sessions || sessions.length===0) return null;
  const result={};
  _DOMAINS.forEach(d=>{
    const gs=sessions.filter(s=>s.game_name===d.key).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    if(gs.length===0){result[d.key]=null;return;}
    const scores=gs.map(s=>(s.score/s.max_score)*100);
    let trend='stable';
    if(scores.length>=2){
      const mid=Math.floor(scores.length/2);
      const first=scores.slice(0,mid).reduce((a,b)=>a+b,0)/mid;
      const last =scores.slice(mid).reduce((a,b)=>a+b,0)/(scores.length-mid);
      if(last-first>8) trend='improving';
      if(first-last>8) trend='declining';
    }
    result[d.key]={trend,latest:Math.round(scores[scores.length-1]),sessions:gs.length};
  });
  return result;
}

function _makePDF(){
  if(!window.jspdf) throw new Error('jsPDF not loaded.');
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const PW=210,PH=297,M=18,CW=174;
  const fill  =(c)=>doc.setFillColor(...c);
  const tc    =(c)=>doc.setTextColor(...c);
  const sk    =(c,lw=0.3)=>{doc.setDrawColor(...c);doc.setLineWidth(lw);};
  const rct   =(x,y,w,h,c,r=0)=>{fill(c);r>0?doc.roundedRect(x,y,w,h,r,r,'F'):doc.rect(x,y,w,h,'F');};
  const hline =(y,col=_NC.border,lw=0.25)=>{sk(col,lw);doc.line(M,y,M+CW,y);};
  const t     =(s,x,y,sz=8.5,st='normal',al='left',col=_NC.dark)=>{
    doc.setFontSize(sz);doc.setFont('helvetica',st);tc(col);doc.text(s,x,y,{align:al});
  };
  const serif =(s,x,y,sz=12,al='left',col=_NC.dark)=>{
    doc.setFontSize(sz);doc.setFont('times','bold');tc(col);doc.text(s,x,y,{align:al});
  };
  return {doc,PW,PH,M,CW,fill,tc,sk,rct,hline,t,serif};
}

async function _pageHeader(p,doc,PW,M,CW,rct,hline,t,serif,subtitle){
  rct(0,0,PW,3,_NC.matcha);
  rct(0,3,PW,33,_NC.surface);
  hline(36,_NC.border,0.3);
  try {
    const logoB64 = await _loadImageAsBase64('static/icons/icon-192-verde.png');
    if (logoB64) {
      rct(M, 8, 14, 14, _NC.matcha, 3);
      doc.addImage(logoB64, 'PNG', M, 8, 14, 14);
    } else {
      rct(M,8,14,14,_NC.matcha,2);
      t('NC',M+2,18,20,'bold','left',_NC.surface2);
    }
  } catch(e) {
    rct(M,8,14,14,_NC.matcha,2);
    t('NC',M+2,18,20,'bold','left',_NC.surface2);
  }
  serif('NeuroClass',M+18,15,16,'left',_NC.matchaDk);
  t(subtitle,M+18,22,10,'normal','left',_NC.muted);
  t('Patient',PW-M,10,10,'bold','right',_NC.muted);
  serif(p.name||'—',PW-M,18,15,'right',_NC.dark);
  t('DOB: '+(p.dob||'—')+'   ·   ID: '+(p.dni||'—'),PW-M,24,8,'normal','right',_NC.muted);
  t('Generated: '+_fmtDT(),PW-M,30,8,'normal','right',_NC.muted);
  return 42;
}

function _sectionHeader(label,y,M,CW,rct,t){
  y+=5;
  rct(M,y,CW,8,_NC.surface);
  t(label.toUpperCase(),M+5,y+5.8,9,'bold','left',_NC.muted);
  return y+13;
}

function _infoRow(label,value,y,M,t,isLast,doc){
  t(label,M+5,y+7,10,'normal','left',_NC.muted);
  t(value||'—',M+62,y+7,9,'bold','left',_NC.dark);
  if(!isLast){doc.setDrawColor(..._NC.border);doc.setLineWidth(0.15);doc.line(M,y+11,M+174,y+11);}
  return y+11;
}

function _confBars(allConf,predicted,y,M,CW,fill,t,doc){
  const lw=50,bx=M+lw,bw=CW-lw-20;
  _ORDER.forEach(s=>{
    const val=_clamp(allConf[s]);
    const sel=s===predicted;
    doc.setFont('helvetica',sel?'bold':'normal');doc.setFontSize(8);
    doc.setTextColor(...(sel?_NC.dark:_NC.muted));
    doc.text(_STAGE[s].label,M,y+4.5);
    fill(_NC.cream);doc.roundedRect(bx,y,bw,5,2,2,'F');
    if(val>0.005){fill(_STAGE[s].color);doc.roundedRect(bx,y,bw*val,5,2,2,'F');}
    doc.setFont('helvetica',sel?'bold':'normal');
    doc.setTextColor(...(sel?_NC.matchaDk:_NC.muted));
    doc.text(Math.min(val*100,99.9).toFixed(1)+'%',M+CW,y+4.5,{align:'right'});
    y+=9;
  });
  return y+3;
}

function _domainTable(domains,y,M,CW,rct,t,fill,doc){
  if(!domains){
    t('No cognitive exercise data available.',M,y+7,8,'italic','left',_NC.muted);
    return y+15;
  }
  const c1=74,c2=58;
  rct(M,y,CW,10,_NC.matcha);
  t('Cognitive Domain',M+5,y+7,10,'bold','left',_NC.surface2);
  t('Exercise',M+c1+5,y+7,10,'bold','left',_NC.surface2);
  t('Trend',M+c1+c2+5,y+7,10,'bold','left',_NC.surface2);
  y+=10;
  _DOMAINS.forEach((d,i)=>{
    const info=domains[d.key];
    rct(M,y,CW,11,i%2===0?_NC.surface2:_NC.light);
    t(d.label,M+5,y+8,9,'bold','left',_NC.dark);
    t(d.game,M+c1+5,y+8,9,'normal','left',_NC.muted);
    if(!info){
      t('No data',M+c1+c2+5,y+8,9,'italic','left',_NC.muted);
    } else {
      const tLabel=info.trend==='improving'?'Improving':info.trend==='declining'?'Declining':'Stable';
      const tCol  =info.trend==='improving'?_NC.stageNone:info.trend==='declining'?_NC.stageMod:_NC.stageVMild;
      const pw=30;
      rct(M+c1+c2+5,y+2.5,pw,7,tCol,2);
      t(tLabel,M+c1+c2+5+pw/2,y+8,9,'bold','center',_NC.white);
      t('('+info.sessions+' sess.)',M+c1+c2+pw+8,y+8,7,'normal','left',_NC.muted);
    }
    doc.setDrawColor(..._NC.border);doc.setLineWidth(0.15);doc.line(M,y+11,M+CW,y+11);
    y+=11;
  });
  return y+5;
}

function _notesSection(notes,y,M,CW,rct,t,doc,PH){
  if(!notes||notes.length===0){
    rct(M,y,CW,10,_NC.light,2);
    t('No clinical notes recorded for this patient.',M+CW/2,y+7,9,'italic','center',_NC.muted);
    return y+18;
  }
  notes.forEach(n=>{
    const lines=doc.splitTextToSize(n.note||'',CW-14);
    const bh=14+lines.length*6;
    if(y+bh>PH-22){doc.addPage();y=18;}
    rct(M,y,3,bh,_NC.matcha);
    rct(M+3,y,CW-3,bh,_NC.cream,0,2);
    t(_fmtDT(n.created_at),M+8,y+7,9,'normal','left',_NC.muted);
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(..._NC.dark);
    doc.text(lines,M+8,y+13);
    y+=bh+5;
  });
  return y;
}

function _editableNotesField(y,M,CW,doc,sk,t,PH){
  if(y+45>PH-22){doc.addPage();y=18;}
  doc.setFontSize(7.5);doc.setFont('helvetica','bold');
  doc.setTextColor(..._NC.muted);
  doc.text('ADDITIONAL NOTES',M+7,y+6.5);
  doc.setLineWidth(0.4);doc.setDrawColor(..._NC.border);
  doc.roundedRect(M,y+9,CW,32,2,2);
  doc.setFillColor(..._NC.surface);
  doc.roundedRect(M,y+9,CW,32,2,2,'F');
  t('Click here to type when viewing in a PDF reader (Adobe, Preview, etc.)',M+5,y+20,9,'italic','left',_NC.muted);
  try {
    const tf=new doc.AcroFormTextField();
    tf.fieldName='additionalNotes';tf.x=M;tf.y=y+9;
    tf.width=CW;tf.height=32;tf.multiline=true;tf.fontSize=9;
    doc.addField(tf);
  } catch(e){ console.warn('AcroForm field error:',e); }
  return y+46;
}

function _footer(doc,PW,PH,M,CW){
  const pages=doc.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);
    doc.setDrawColor(..._NC.border);doc.setLineWidth(0.25);doc.line(M,PH-14,M+CW,PH-14);
    doc.setFontSize(6.5);doc.setFont('helvetica','italic');doc.setTextColor(..._NC.muted);
    doc.text('NeuroClass  ·  Universidad de Deusto  ·  Bilbao, Spain  ·  For clinical support only — not a substitute for professional medical diagnosis.',M,PH-8);
    doc.setFont('helvetica','normal');
    doc.text('Page '+p+' of '+pages,M+CW,PH-8,{align:'right'});
  }
}

function _doctorSection(doctor,y,M,t,doc,rct,CW){
  y=_sectionHeader('Physician Information',y,M,CW,rct,t);
  y=_infoRow('Full name',    doctor.name||'—',       y,M,t,false,doc);
  y=_infoRow('DNI',          doctor.dni||'—',         y,M,t,false,doc);
  y=_infoRow('N. Colegiado', doctor.colegiado||'—',   y,M,t,false,doc);
  y=_infoRow('Specialty',    'Neurology',              y,M,t,false,doc);
  y=_infoRow('Institution',  'Universidad de Deusto',  y,M,t,true, doc);
  return y+6;
}

function _patientSection(patient,y,M,t,doc,rct,CW){
  y=_sectionHeader('Patient Information',y,M,CW,rct,t);
  y=_infoRow('Full name',        patient.name        ||'—', y,M,t,false,doc);
  y=_infoRow('ID (DNI)',         patient.dni         ||'—', y,M,t,false,doc);
  y=_infoRow('Date of birth',    patient.dob         ||'—', y,M,t,false,doc);
  y=_infoRow('Phone',            patient.phone       ||'—', y,M,t,false,doc);
  y=_infoRow('Neurologist',      patient.neurologist ||'—', y,M,t,false,doc);
  y=_infoRow('Last appointment', patient.lastAppt ? _fmt(patient.lastAppt) : '—', y,M,t,false,doc);
  y=_infoRow('Total assessments',String(patient.totalSessions||0)+' MRI prediction'+(patient.totalSessions!==1?'s':''), y,M,t,true,doc);
  return y+6;
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL PREDICTION REPORT
// ═══════════════════════════════════════════════════════════════
async function generateAndUploadReport({
  patient, doctor, prediction, gradcamBase64,
  gameScores, gameSessions, notes, predictionId, supabase
}) {
  const {doc,PW,PH,M,CW,fill,tc,sk,rct,hline,t,serif}=_makePDF();
  const stage=_STAGE[prediction.stage]||_STAGE.NonDemented;
  const conf =_clamp(prediction.confidence);

  let mriBase64    = prediction.mriBase64    || null;
  let gradcamFinal = gradcamBase64            || prediction.gradcamBase64 || null;

  if (!mriBase64 && prediction.mri_path) {
    const url = await _getSignedUrl(supabase, prediction.mri_path);
    if (url) mriBase64 = await _loadImageAsBase64(url);
  }
  if (!gradcamFinal && prediction.gradcam_path) {
    const url = await _getSignedUrl(supabase, prediction.gradcam_path);
    if (url) gradcamFinal = await _loadImageAsBase64(url);
  }

  let y=await _pageHeader(patient,doc,PW,M,CW,rct,hline,t,serif,'Clinical Prediction Report  ·  '+_fmt());
  y=_patientSection(patient,y,M,t,doc,rct,CW);
  y=_doctorSection(doctor,y,M,t,doc,rct,CW);

  y=_sectionHeader('Diagnosis',y,M,CW,rct,t);
  rct(M,y,3,26,stage.color);
  rct(M+3,y,CW-3,26,_NC.surface);
  t('PREDICTED STAGE',M+10,y+7,7,'bold','left',_NC.muted);
  serif(stage.label,M+10,y+18,13,'left',_NC.dark);
  t('CONFIDENCE',PW-M-38,y+7,7,'bold','right',_NC.muted);
  serif((conf*100).toFixed(1)+'%',PW-M,y+18,16,'right',_NC.muted);
  t('Report ID: '+predictionId.slice(0,8).toUpperCase(),M+10,y+25,6.5,'normal','left',_NC.muted);
  y+=32;

  y=_sectionHeader('Classification Probabilities',y,M,CW,rct,t);
  y=_confBars(prediction.allConfidences||{},prediction.stage,y,M,CW,fill,t,doc);
  y+=3;

  if (mriBase64 || gradcamFinal) {
    y=_sectionHeader('Brain Imaging',y,M,CW,rct,t);
    try {
      const iW=62,iH=62;
      let ix=M;
      if (mriBase64) {
        const src=mriBase64.startsWith('data:')?mriBase64:'data:image/jpeg;base64,'+mriBase64;
        sk(_NC.border,0.3);doc.roundedRect(ix,y,iW,iH,2,2);
        doc.addImage(src,'JPEG',ix,y,iW,iH);
        t('Original MRI',ix+iW/2,y+iH+5,7.5,'normal','center',_NC.muted);
        ix+=iW+8;
      }
      if (gradcamFinal) {
        const src=gradcamFinal.startsWith('data:')?gradcamFinal:'data:image/jpeg;base64,'+gradcamFinal;
        sk(_NC.border,0.3);doc.roundedRect(ix,y,iW,iH,2,2);
        doc.addImage(src,'JPEG',ix,y,iW,iH);
        t('Grad-CAM',ix+iW/2,y+iH+5,7.5,'normal','center',_NC.muted);
        const tx=ix+iW+8,tw=M+CW-tx;
        if(tw>30){
          t('Activation map',tx,y+8,8.5,'bold','left',_NC.dark);
          const cap='Warmer colours indicate regions with stronger influence on the predicted stage.';
          doc.setFontSize(8);doc.setFont('helvetica','normal');tc(_NC.muted);
          doc.text(doc.splitTextToSize(cap,tw),tx,y+16);
          t('Stage: '+stage.label,tx,y+42,8,'normal','left',_NC.muted);
          t('Confidence: '+(conf*100).toFixed(1)+'%',tx,y+50,8,'normal','left',_NC.muted);
        }
      }
      y+=iH+12;
    } catch(e){ console.warn('Image render error:',e); y+=2; }
  }

  if(gameSessions&&gameSessions.length>0){
    if(y+90>PH-22){doc.addPage();y=18;}
    y=_sectionHeader('Cognitive Assessment Summary',y,M,CW,rct,t);
    y=_domainTable(_computeDomains(gameSessions),y,M,CW,rct,t,fill,doc);
  }

  if(y+50>PH-22){doc.addPage();y=18;}
  y=_sectionHeader('Clinical Notes',y,M,CW,rct,t);
  y=_notesSection(notes,y,M,CW,rct,t,doc,PH);
  y=_editableNotesField(y,M,CW,doc,sk,t,PH);
  _footer(doc,PW,PH,M,CW);

  const filename='NeuroClass_'+patient.dni+'_'+new Date().toISOString().slice(0,10)+'_'+predictionId.slice(0,8)+'.pdf';
  doc.save(filename);

  const blob=doc.output('blob');
  const path=patient.id+'/'+predictionId+'.pdf';
  const {error:upErr}=await supabase.storage.from('neuro-reports').upload(path,blob,{contentType:'application/pdf',upsert:true});
  if(upErr) return {success:false,error:upErr};
  const {data:signed,error:urlErr}=await supabase.storage.from('neuro-reports').createSignedUrl(path,31536000);
  if(urlErr) return {success:false,error:urlErr};
  return {success:true,reportUrl:signed.signedUrl,filename};
}

async function _getSignedUrl(supabase, path) {
  if (!path) return null;
  try {
    const { data } = supabase.storage
      .from('gradcam-images')
      .getPublicUrl(path);
    return data?.publicUrl || null;
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// EVOLUTION REPORT
// ═══════════════════════════════════════════════════════════════
async function generateEvolutionReport({patient,doctor,predictions,gameSessions,notes,supabase}){
  const {doc,PW,PH,M,CW,fill,tc,sk,rct,hline,t,serif}=_makePDF();
  const sorted=[...predictions].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

  let y=await _pageHeader(
    patient,doc,PW,M,CW,rct,hline,t,serif,
    'Evolution Report  ·  '+sorted.length+' prediction'+(sorted.length!==1?'s':'')+
    '  ·  '+_fmt(sorted[0]?.created_at)+' – '+_fmt(sorted[sorted.length-1]?.created_at)
  );
  y=_patientSection(patient,y,M,t,doc,rct,CW);
  y=_doctorSection(doctor,y,M,t,doc,rct,CW);

  if(sorted.length>=2){
    y=_sectionHeader('Staging Evolution',y,M,CW,rct,t);
    const first=_STAGE[sorted[0].predicted_class]||_STAGE.NonDemented;
    const last =_STAGE[sorted[sorted.length-1].predicted_class]||_STAGE.NonDemented;
    const fi=first.idx,li=last.idx;
    const tLabel=li>fi?'Worsening':li<fi?'Improving':'Stable';
    const tCol  =li>fi?_NC.stageMod:li<fi?_NC.stageNone:_NC.stageVMild;
    rct(M,y,CW,30,_NC.light);
    rct(M+6,y+4,52,8,first.color,3);
    t(first.label,M+6+26,y+10,9,'bold','center',_NC.surface2);
    t(_fmt(sorted[0].created_at),M+6+26,y+19,9,'normal','center',_NC.muted);
    t('-->',PW/2,y+13,11,'bold','center',_NC.dark);
    rct(PW-M-58,y+4,52,8,last.color,3);
    t(last.label,PW-M-58+26,y+10,9,'bold','center',_NC.surface2);
    t(_fmt(sorted[sorted.length-1].created_at),PW-M-58+26,y+19,9,'normal','center',_NC.muted);
    const tw2=48;
    rct(M+CW/2-tw2/2,y+18,tw2,8,tCol,3);
    t(tLabel,M+CW/2,y+24,9,'bold','center',_NC.surface2);
    y+=38;
  }

  if(y+20>PH-22){doc.addPage();y=18;}
  y=_sectionHeader('Prediction History',y,M,CW,rct,t);

  for(let i=0;i<sorted.length;i++){
    const r   =sorted[i];
    const meta=_STAGE[r.predicted_class]||_STAGE.NonDemented;
    const conf=_clamp(r.confidence);
    const hasImg=!!(r.mri_url||r.gradcam_url||r.mri_path||r.gradcam_path);
    const blockH=hasImg?72:28;
    if(y+blockH>PH-22){doc.addPage();y=18;}

    rct(M,y,CW,12,i%2===0?_NC.surface2:_NC.surface2);
    fill(meta.color);doc.circle(M+6,y+6,3.5,'F');
    t(_fmt(r.created_at),M+13,y+7.5,9,'bold','left',_NC.dark);
    t(meta.label,M+65,y+7.5,9,'normal','left',meta.color);
    t(Math.min(conf*100,99.9).toFixed(1)+'% confidence',M+CW,y+7.5,8.5,'bold','right',_NC.matcha);
    y+=14;

    if(hasImg){
      y+=3;
      const iW=42,iH=42;
      let ix=M;
      
      const imgPairs = [
        { url: r.mri_path     ? (await _getSignedUrl(supabase, r.mri_path))     : (r.mri_url     || null), label: 'Original MRI' },
        { url: r.gradcam_path ? (await _getSignedUrl(supabase, r.gradcam_path)) : (r.gradcam_url || null), label: 'Grad-CAM'     },
      ];
      for(const {url,label} of imgPairs){
        if(!url) continue;
        const b64=await _loadImageAsBase64(url);
        if(!b64){
          rct(ix,y,iW,iH,_NC.surface);
          sk(_NC.border,0.3);doc.roundedRect(ix,y,iW,iH,2,2);
          t('Image unavailable',ix+iW/2,y+iH/2,7,'italic','center',_NC.muted);
          t(label,ix+iW/2,y+iH+5,7.5,'normal','center',_NC.muted);
          ix+=iW+8;
          continue;
        }
        try{
          sk(_NC.matchaLt,0.3);doc.roundedRect(ix,y,iW,iH,2,2);
          doc.addImage(b64,'JPEG',ix,y,iW,iH);
        }catch(e){ console.warn('addImage error for '+label+':',e.message); }
        t(label,ix+iW/2,y+iH+5,7.5,'normal','center',_NC.muted);
        ix+=iW+8;
      }
      y+=iH+12;
    }

    if(i<sorted.length-1){
      sk(_NC.matchaLt,0.2);doc.line(M,y,M+CW,y);
      y+=6;
    }
  }

  if(gameSessions&&gameSessions.length>0){
    if(y+90>PH-22){doc.addPage();y=18;}
    y=_sectionHeader('Cognitive Assessment Summary',y,M,CW,rct,t);
    y=_domainTable(_computeDomains(gameSessions),y,M,CW,rct,t,fill,doc);
  }

  if(y+50>PH-22){doc.addPage();y=18;}
  y=_sectionHeader('Clinical Notes',y,M,CW,rct,t);
  y=_notesSection(notes,y,M,CW,rct,t,doc,PH);
  y=_editableNotesField(y,M,CW,doc,sk,t,PH);
  _footer(doc,PW,PH,M,CW);

  const filename='NeuroClass_Evolution_'+patient.dni+'_'+new Date().toISOString().slice(0,10)+'.pdf';
  doc.save(filename);
}