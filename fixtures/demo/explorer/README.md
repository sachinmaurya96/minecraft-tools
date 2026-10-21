# Teal Explorer — demo reference photos

An original synthetic character created with the built-in image generation tool
on 2026-10-21. Four PNG reference renders, each 1024 × 1536, for testing the
Character Builder's photo uploads, crop/mask controls and colour projection.
Exact generation prompts are in `prompts.json`.

| File        | Upload slot            | Visible view                   |
| ----------- | ---------------------- | ------------------------------ |
| `front.png` | Front                  | Face toward camera             |
| `back.png`  | Back                   | Back of head, jacket and boots |
| `left.png`  | Character's left side  | Nose points left in the image  |
| `right.png` | Character's right side | Nose points right in the image |

## Try it

1. Open Character Builder → Make a skin → Use my photos (or choose a template).
2. Expand Reference photos and tick the image-use checkbox.
3. Upload each file to its matching slot. Start with only `front.png` to test
   missing-view handling, then add the other three.
4. Open Photo-assisted…, use Fit boxes to subject, and adjust each guide box:
   hair/face for Head, teal jacket for Torso/Arms, navy trousers for Legs.
   The stylized proportions need manual box adjustments.
5. Check the background mask, apply the result, paint corrections and download.

The photo-assisted workflow copies colours from the selected regions. Expect
an editable approximation. The references also work with the entity photo
palette and Photo humanoid tools.

Useful expected colours: brown hair, tan face/hands/boots, teal upper body,
orange scarf and navy legs. The light background should be easy to mask.
