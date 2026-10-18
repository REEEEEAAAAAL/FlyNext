"use client";
import { useRef, useState } from "react";

export default function ImageGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  if (!images.length) return <div className="surface p-8 text-center muted">Photos coming soon. Explore room details and amenities below.</div>;
  return <>
    <div className="image-gallery">{images.map((image, index) => <button type="button" key={`${image}-${index}`} onClick={() => { setSelected(index); dialog.current?.showModal(); }} aria-label={`View photo ${index + 1} of ${name}`}><img src={image} alt={`${name}, photo ${index + 1}`} loading="lazy" /></button>)}</div>
    <dialog ref={dialog} className="gallery-dialog" aria-label={`${name} photo viewer`} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="flex items-center justify-between gap-3 mb-4"><p>Photo {selected + 1} of {images.length}</p><button className="button-secondary" type="button" onClick={() => dialog.current?.close()} autoFocus>Close photos</button></div>
      <img src={images[selected]} alt={`${name}, photo ${selected + 1}`} />
      <div className="flex justify-between gap-3 mt-4"><button type="button" className="button-secondary" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>Previous</button><button type="button" className="button-secondary" disabled={selected === images.length - 1} onClick={() => setSelected(selected + 1)}>Next</button></div>
    </dialog>
  </>;
}
