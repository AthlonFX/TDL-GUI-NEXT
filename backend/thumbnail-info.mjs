function selectSize(sizes) {
  const usable=(sizes||[]).filter(size=>size.Type&&/^[a-zA-Z0-9]$/.test(size.Type)&&size.Type!=='i'&&size.W>0&&size.H>0);
  const preferred=usable.filter(size=>Math.max(size.W,size.H)<=640);
  return (preferred.length?preferred:usable).sort((a,b)=>preferred.length?(b.W*b.H-a.W*a.H):(a.W*a.H-b.W*b.H))[0];
}
export function thumbnailInfo(message) {
  const media=message.raw?.Media;
  if(!media)return null;
  const document=media.Document||media.Webpage?.Document;
  const photo=media.Photo||media.VideoCover||media.Webpage?.Photo;
  const docSize=selectSize(document?.Thumbs);
  const photoSize=selectSize(photo?.Sizes);
  const item=docSize?document:photoSize?photo:null;
  const size=docSize||photoSize;
  if(!item||!size||!item.ID||!item.AccessHash||!item.FileReference)return null;
  return {kind:docSize?'document':'photo',id:String(item.ID),accessHash:String(item.AccessHash),fileReference:item.FileReference,
    dcId:item.DCID,thumbSize:size.Type,width:size.W,height:size.H,size:size.Size||size.Sizes?.at(-1)||0};
}
export function parseMessageWithThumbnail(source) {
  const message=JSON.parse(source);
  // JSON numbers for Telegram's 64-bit IDs must retain their exact digits.
  const precise=JSON.parse(source,(key,value,context)=>typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)?context.source:value);
  const info=thumbnailInfo(precise);
  if(info)message.previewFileLocation=info;
  return message;
}
