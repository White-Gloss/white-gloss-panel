export async function prepareProtocolPhotos(files,upload){
  if(files.length>20)throw Error('Höchstens 20 Zustandsfotos pro Protokoll.');
  const photos=[],photoPreviews={};
  for(const file of files){
    const original=await upload(file);photos.push(original);
    if(file.type==='image/webp'||file.size>500000){
      const bitmap=await createImageBitmap(file);
      try{
        const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const preview=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));if(!preview)throw Error('PDF-Fotovorschau konnte nicht erstellt werden. Das Original wurde geschützt gespeichert.');
        photoPreviews[original]=await upload(new File([preview],'Protokollvorschau.jpg',{type:'image/jpeg'}));
      }finally{bitmap.close();}
    }
  }
  return {photos,photoPreviews};
}
