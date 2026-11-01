import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { parseMessageWithThumbnail } from './thumbnail-info.mjs';

// Read complete message objects while tdl writes its export. Each page stops
// after one extra record, so an ID cursor never exports the entire chat again.
export class ExportPageReader {
  constructor(filename, limit = 51) {
    this.filename=filename;this.limit=limit;this.offset=0;this.decoder=new StringDecoder('utf8');
    this.buffer='';this.cursor=0;this.started=false;this.inString=false;this.escaped=false;this.depth=0;this.objectStart=-1;this.messages=[];this.complete=false;this.id=null;
  }
  read() {
    if(this.messages.length>=this.limit)return true;
    let fd;
    try {fd=fs.openSync(this.filename,'r');}catch(error){if(error.code==='ENOENT')return false;throw error;}
    try {
      const bytes=Buffer.alloc(65536);let length;
      while((length=fs.readSync(fd,bytes,0,bytes.length,this.offset))>0) {
        this.offset+=length;this.buffer+=this.decoder.write(bytes.subarray(0,length));
        if(this.parse())return true;
      }
    } finally {fs.closeSync(fd);}
    return this.messages.length>=this.limit;
  }
  parse() {
    if(!this.started){const start=/"messages"\s*:\s*\[/.exec(this.buffer);if(!start)return false;this.id=JSON.parse(this.buffer.slice(0,start.index).replace(/,\s*$/,'')+'}').id;this.cursor=start.index+start[0].length;this.started=true;}
    for(;this.cursor<this.buffer.length;this.cursor++) {
      const char=this.buffer[this.cursor];
      if(this.inString){if(this.escaped)this.escaped=false;else if(char==='\\')this.escaped=true;else if(char==='"')this.inString=false;continue;}
      if(char==='"'){this.inString=true;continue;}
      if(this.depth===0){if(char===']'){this.complete=true;return false;}if(char==='{')this.objectStart=this.cursor;}
      if(char==='{'||char==='[')this.depth++;
      else if(char==='}'||char===']'){
        this.depth--;
        if(this.depth===0&&this.objectStart>=0){this.messages.push(parseMessageWithThumbnail(this.buffer.slice(this.objectStart,this.cursor+1)));this.objectStart=-1;if(this.messages.length>=this.limit){this.cursor++;return true;}}
      }
    }
    // Discard records already parsed; preserve only a possibly unfinished one.
    const keep=this.objectStart>=0?this.objectStart:this.cursor;
    this.buffer=this.buffer.slice(keep);this.cursor-=keep;if(this.objectStart>=0)this.objectStart=0;
    return false;
  }
  page(size=50) {
    const messages=this.messages.slice(0,size);
    const oldest=messages.reduce((result,message)=>!result||message.id<result.id?message:result,null);
    return {raw:{id:this.id,messages},hasMore:this.messages.length>size,cursor:oldest?{beforeId:oldest.id,beforeDate:oldest.date||oldest.raw?.Date||0}:null};
  }
}
