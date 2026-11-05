import importlib.util
from pathlib import Path
import json
import os
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'portable-install.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
class PortableInstallerTest(unittest.TestCase):
 def test_long_unicode_paths_install_and_verify(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);relative='backend/'+('/'.join(['nested-directory']*20))+'/文件.js';archive=root/'release.zip';data=b'export const value=1;'
   import hashlib
   manifest={'files':[{'path':relative,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}]}
   with zipfile.ZipFile(archive,'w') as z:z.writestr(relative,data);z.writestr('latest.json',json.dumps(manifest))
   source=root/'解压目录';dest=root/'全新电脑 安装目录';helper.extract(archive,source);helper.verify(source);helper.install(source,dest)
   with open(helper.target(dest,relative),'rb') as f:self.assertEqual(f.read(),data)
   helper.install(source,dest)
   # Use the same extended paths on Windows when cleaning deep test directories.
   if os.name=='nt':
    import shutil
    shutil.rmtree(helper.native(source));shutil.rmtree(helper.native(dest))
 def test_rejects_traversal_and_unexpected_root(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.assertRaises(ValueError):helper.target(folder,'../outside')
   p=Path(folder)/'latest.json';p.write_text(json.dumps({'files':[{'path':'data/private.db','sha256':'0'*64}]}))
   with self.assertRaises(ValueError):helper.verify(folder)
if __name__=='__main__':unittest.main()
