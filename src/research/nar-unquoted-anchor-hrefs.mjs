const space=c=>/[\t\n\f\r ]/.test(c);
const rawTags=new Set(['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript']);

function unquotedHref(body){
  let i=0,href=null,hrefCount=0,unquoted=false;
  while(i<body.length){
    const before=i;while(i<body.length&&space(body[i]))i++;
    if(i===body.length||body.slice(i).trim()==='/')break;
    if(i===before)return {rejected:true};
    const start=i;while(i<body.length&&!/[\t\n\f\r =/]/.test(body[i]))i++;
    const name=body.slice(start,i).toLowerCase();if(!name||/[\u0000-\u001f"'<>`]/.test(name))return {rejected:true};
    const afterName=i;while(i<body.length&&space(body[i]))i++;
    let value=null,form='BOOLEAN';
    if(body[i]==='='){
      i++;while(i<body.length&&space(body[i]))i++;
      const quote=body[i];
      if(quote==='"'||quote==="'"){
        i++;const end=body.indexOf(quote,i);if(end<0)return {rejected:true};value=body.slice(i,end);form='QUOTED';i=end+1;
      }else{
        const at=i;while(i<body.length&&!space(body[i]))i++;value=body.slice(at,i);form='UNQUOTED';
        // '=' inside a URL query is retained. Ambiguous quote/control forms fail closed.
        if(!value||/[\u0000-\u0020\u007f"'<>`]/.test(value))return {rejected:true};
      }
    }else i=afterName;
    if(name==='href'){hrefCount++;href=value;unquoted=form==='UNQUOTED';}
  }
  if(hrefCount>1)return {rejected:true};
  return {value:hrefCount===1&&unquoted?href:null,rejected:false};
}

// Narrow start-tag scanner for the new unquoted-anchor extension, not a full DOM.
// Raw values are internal inputs to the identity validator, never report fields.
export function extractNarUnquotedAnchorHrefs(html){
  if(typeof html!=='string'||Buffer.byteLength(html,'utf8')>1000000)return {hrefs:[],anchorCount:0,rejectedAnchorCount:0};
  const hrefs=[],inactive={template:0,svg:0,math:0};let i=0,anchorCount=0,rejectedAnchorCount=0;
  while(i<html.length){
    const start=html.indexOf('<',i);if(start<0)break;
    if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0)break;i=end+3;continue;}
    if(html.startsWith('<!',start)||html.startsWith('<?',start)){
      let at=start+2,q=null;for(;at<html.length;at++){const c=html[at];if(q){if(c===q)q=null;}else if(c==='"'||c==="'")q=c;else if(c==='>')break;}i=at+1;continue;
    }
    const match=/^<(\/?)([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/i.exec(html.slice(start));
    if(!match){i=start+1;continue;}
    const closing=match[1]==='/',tag=match[2].toLowerCase(),bodyStart=start+match[0].length;
    let end=bodyStart,quote=null;
    for(;end<html.length;end++){
      const c=html[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;
    }
    if(end===html.length)break;i=end+1;
    if(tag==='plaintext'&&!closing)break;
    if(rawTags.has(tag)&&!closing){
      const close=new RegExp(`</${tag}[\\t\\n\\f\\r ]*>`,'ig');close.lastIndex=i;const found=close.exec(html);if(!found)break;i=close.lastIndex;continue;
    }
    if(Object.hasOwn(inactive,tag)){if(!closing&&tag!=='template'&&/\/\s*$/.test(html.slice(bodyStart,end)))continue;inactive[tag]=Math.max(0,inactive[tag]+(closing?-1:1));continue;}
    if(closing||tag!=='a'||Object.values(inactive).some(n=>n>0))continue;
    anchorCount++;const parsed=unquotedHref(html.slice(bodyStart,end));
    if(parsed.rejected)rejectedAnchorCount++;else if(parsed.value!==null)hrefs.push(parsed.value);
  }
  return {hrefs,anchorCount,rejectedAnchorCount};
}
