import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('patch',Path(__file__).resolve().parents[1]/'task_schema_patch.py')
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)

class StartupPatchTest(unittest.TestCase):
    def test_runs_before_old_state_receipt_can_skip_and_after_fresh_schema_initialization(self):
        source="import {DatabaseSync, backup} from 'node:sqlite';\nconst dataRoot = path.join(installRoot, 'data');\nif (receipt) process.exit(0);\nconst nextRegistry = [];"
        result=patch.repair_apply_state(source)
        self.assertLess(result.index('await ensureTaskSchema(path.join'),result.index('if (receipt)'))
        self.assertLess(result.index('await ensureTaskSchema(dbPath)'),result.index('const nextRegistry'))
        self.assertEqual(patch.repair_apply_state(result),result)
    def test_unknown_startup_structure_is_rejected(self):
        with self.assertRaises(AssertionError):patch.repair_apply_state('changed startup')

if __name__=='__main__':unittest.main()
