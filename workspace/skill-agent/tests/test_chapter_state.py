import importlib.util
import pathlib
import subprocess
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('chapter_state_patch', root / 'chapter_state_patch.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ChapterStateTests(unittest.TestCase):
    def test_empty_chapter_recovery_and_null_task_guards(self):
        fixture = 't?.chapterId===V?.id&&t.kind===`characters`;t?.chapterId===V?.id&&t.kind===`storyboard`;q=l({mutationFn:t=>_t(e.project.id,t.map('
        patched = module.repair_chapter_code(fixture)
        self.assertEqual(module.repair_chapter_code(patched), patched)
        effect = patched.split('ysaEmptyChapterEffect=', 1)[1].split(',q=l(', 1)[0]
        script = '''
const assert=require('node:assert/strict');
let t=null,V=undefined;
assert.equal(!!(t&&V&&t.chapterId===V.id&&t.kind==='characters'),false);
let calls=[],ref={current:null},z=[],e={project:{id:'p'}},K={mutate:value=>calls.push(value)};
let Q={useEffect:fn=>fn()};
let ysaEmptyChapterAttempt=ref;
const render=()=>EFFECT;
render();render();assert.deepEqual(calls,[{title:'1'}]);
z=[{id:'new'}];render();z=[];render();assert.equal(calls.length,2);
e.project.id='other';render();assert.equal(calls.length,3);
'''.replace('EFFECT', effect)
        subprocess.run(['node', '-e', script], check=True, capture_output=True)

    def test_changed_baseline_is_rejected(self):
        with self.assertRaises(AssertionError):
            module.repair_chapter_code('changed build')

if __name__ == '__main__':
    unittest.main()
