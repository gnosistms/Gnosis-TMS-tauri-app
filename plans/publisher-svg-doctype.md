# Publisher SVG import compatibility

The supplied vector logo is rejected because its design-tool export includes the
standard SVG 1.1 public DOCTYPE. The importer currently rejects every DOCTYPE.

1. Accept only the standard SVG 1.1 declaration, without resolving its external
   DTD, and strip it before hashing, caching, or previewing the imported asset.
2. Preserve rejection of custom DTDs, entities, active content, and external
   resources. Add focused regression coverage alongside the existing validator.
3. Run native book-image tests and validate the supplied logo. Provide a cleaned
   copy for immediate use with the current app build, leaving the original intact.

Public-release scope: replace the existing blacklist with a bounded static SVG
profile and canonical XML serialization. Resolve namespaces, validate individual
inline style properties and every local reference, reject processing instructions,
custom entities, unsupported elements/attributes, malformed documents, and excessive
input size/depth/element counts. Cache and preview only the validated output.
Keep unsupported features explicit rather than silently changing the artwork.

Implemented in the native book-image importer. Supported artwork includes paths,
basic shapes, transforms, text, gradients, clipping, and a fixed set of inline
presentation properties. Stylesheets, animation, hyperlinks, embedded images,
reuse elements, masks, filters, and patterns are rejected. Resource definitions
cannot reference other definitions. Limits: 2 MiB, 20,000 elements, depth 64,
128 attributes per element, 32,768 pixels per side, and 100 million pixels total.

Validation:
- Eight native book/SVG tests cover safe artwork, canonicalization, standard DTD
  removal, namespace bypasses, CSS escapes and mixed URLs, entities, malformed XML,
  encoding/processing instructions, recursive references, and resource limits.
- The supplied 15,281-byte logo passes the actual Rust sanitizer. Sanitizing its
  output again is stable; the original file remains unchanged.
- Original and sanitized logos render pixel-identically in installed Chrome at
  512 x 384, with zero resource requests. The sandbox blocked Chrome launch;
  the isolated comparison succeeded with elevated execution permission.
- A sanitized copy is available at /private/tmp/GnosisVN-caduceus-logo.svg for
  immediate use in the existing app build. Updated import behavior needs a rebuild.

Status: complete.
