import json
import sys
import tarfile

archive, expected_image = sys.argv[1:]
with tarfile.open(archive, "r|gz") as image:
    manifest = None
    size = 0
    for count, member in enumerate(image, 1):
        size += member.size
        if count > 10_000 or size > 2_147_483_648:
            raise ValueError("Image archive exceeds deployment limits")
        if member.name == "manifest.json":
            if not member.isfile() or member.size > 65_536 or manifest is not None:
                raise ValueError("Invalid image manifest")
            manifest = json.load(image.extractfile(member))
    if not isinstance(manifest, list) or len(manifest) != 1 or manifest[0].get("RepoTags") != [expected_image]:
        raise ValueError("Archive must contain only the expected product image")
