type PhotoPreview = { previewUrl: string; file: File | null };

/** Local object URLs and saved photos share one ordered list until the form is submitted. */
export default function PhotoPreviews({ photos, onRemove }: {
  photos: PhotoPreview[];
  onRemove: (index: number) => void;
}) {
  return (
    <ul className="photo-previews" aria-label="Selected photos">
      {photos.map(({ previewUrl, file }, index) => {
        const label = file?.name || `Photo ${index + 1}`;
        return (
          <li key={previewUrl}>
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} in a new tab`}>
              <img src={previewUrl} alt={label} />
            </a>
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onRemove(index)}>
              <span aria-hidden="true">×</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
