with open('src/public/index.js', 'r') as f:
    code = f.read()

import re

# We injected: const freeModels = models.filter(m => m.markFree);
# Let's clean up that area and replace it cleanly.
pattern = re.compile(r'const models = res\.models \|\| \[\];\s*const freeModels = models\.filter.*?models\.forEach\(model => \{', re.DOTALL)
replacement = '''const models = res.models || [];
        const freeModels = models.filter(m => m.markFree);
        select.innerHTML = '';
        if (freeModels.length === 0) {
          select.innerHTML = '<option value="" disabled selected>No free models found</option>';
          select.disabled = true;
          return;
        }
        
        let foundFree = false;
        freeModels.forEach(model => {'''

code = pattern.sub(replacement, code)

with open('src/public/index.js', 'w') as f:
    f.write(code)

