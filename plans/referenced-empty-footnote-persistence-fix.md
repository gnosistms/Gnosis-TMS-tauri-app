# Referenced empty footnote persistence fix

1. Preserve a labeled marker when serializing a single referenced empty footnote in
   both the frontend and Rust backend serializers.
2. Add JavaScript and Rust unit coverage for serialization, row merging, and AI
   review correction behavior.
3. Add browser coverage for add, blur/save, row reopen, and footnote reopen.
4. Run focused frontend, backend, and browser verification.
