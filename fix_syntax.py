with open('src/server.js', 'r') as f:
    code = f.read()

bad_start = '];\n    return name ? ['
bad_end = 'const SOURCE_STATS = {};'
idx1 = code.find(bad_start)
idx2 = code.find(bad_end)

if idx1 != -1 and idx2 != -1:
    code = code[:idx1 + 2] + "\n\n" + code[idx2:]
    with open('src/server.js', 'w') as f:
        f.write(code)
    print("Fixed syntax")
else:
    print("Not found")

