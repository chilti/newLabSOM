import os
import glob
import skdim
import re

path = os.path.dirname(skdim.__file__)
files = glob.glob(path + '/**/*.py', recursive=True)

for f in files:
    try:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
    except Exception:
        continue
    
    if 'inspect.getargvalues' in content:
        new_content = re.sub(
            r'(\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*values\s*=\s*inspect\.getargvalues\(inspect\.currentframe\(\)\))',
            r'\1\n        values = dict(values)',
            content
        )
        if new_content != content:
            with open(f, 'w', encoding='utf-8') as file:
                file.write(new_content)
            print(f"Patched {f}")
