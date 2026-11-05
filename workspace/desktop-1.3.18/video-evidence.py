"""Ground video analysis in timed speech, hard subtitles and consecutive face frames."""
import argparse
import base64
import difflib
import json
import os
import re
import uuid
from pathlib import Path
import subprocess

EVIDENCE_VERSION = 2

def run(args):
    return subprocess.run(args,check=True,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

def save(path,value):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
    os.replace(temp,path)

def frame_panels(video,out,ffmpeg,times):
    import cv2
    import numpy as np
    model_bytes=np.frombuffer(Path(__file__).with_name('face_detection_yunet_2023mar.onnx').read_bytes(),np.uint8)
    detector=cv2.FaceDetectorYN.create('onnx',model_bytes,np.empty(0,np.uint8),(320,320),score_threshold=.7)
    frames=[]
    for time in times:
        dest=out/f'evidence-{time}.jpg'
        if not dest.exists():
            raw=run([ffmpeg,'-v','error','-ss',str(time/1000),'-i',str(video),'-frames:v','1','-vf','scale=720:-2','-f','image2pipe','-vcodec','mjpeg','-']).stdout
            image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if image is None:raise ValueError('无法读取定点原片画面')
            detector.setInputSize((image.shape[1],image.shape[0]))
            _,detected=detector.detect(image)
            faces=sorted((detected[:,:4].astype(int).tolist() if detected is not None else []),key=lambda face:face[0])
            height,width=image.shape[:2]
            panel=np.zeros((max(height,400),width+(330 if len(faces) else 0),3),np.uint8)
            panel[:height,:width]=image
            for index,(x,y,w,h) in enumerate(faces[:3]):
                left=max(0,x-w//2);top=max(0,y-h//2)
                right=min(width,x+w+w//2);bottom=min(height,y+h*3)
                crop=image[top:bottom,left:right]
                scale=min(320/crop.shape[1],(panel.shape[0]/min(len(faces),3)-28)/crop.shape[0])
                crop=cv2.resize(crop,None,fx=scale,fy=scale)
                dy=round(index*panel.shape[0]/min(len(faces),3))+24
                panel[dy:dy+crop.shape[0],width+5:width+5+crop.shape[1]]=crop
                cv2.putText(panel,f'Face {index+1}',(width+5,dy-5),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
                cv2.rectangle(panel,(x,y),(x+w,y+h),(0,220,120),1)
            cv2.putText(panel,f'{time/1000:.3f}s',(8,24),cv2.FONT_HERSHEY_SIMPLEX,.7,(0,255,255),2)
            ok,encoded=cv2.imencode('.jpg',panel,[cv2.IMWRITE_JPEG_QUALITY,88])
            if not ok:raise ValueError('定点画面编码失败')
            temporary=dest.with_name(dest.name+'.'+uuid.uuid4().hex+'.tmp')
            temporary.write_bytes(encoded.tobytes());os.replace(temporary,dest)
        frames.append(dict(time_ms=time,image='data:image/jpeg;base64,'+base64.b64encode(dest.read_bytes()).decode()))
    return frames

def enrich(video,out,ffmpeg,model_path,base):
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import get_speech_timestamps,VadOptions
    from rapidocr_onnxruntime import RapidOCR
    from opencc import OpenCC
    def progress(stage,percent):save(out/'progress.json',dict(stage=stage,progress=percent))
    progress('原音重新分句与时间轴核对',57)
    audio=decode_audio(str(out/'audio.wav'),sampling_rate=16000)
    model=WhisperModel(model_path,device='cpu',compute_type='int8',local_files_only=True)
    asr=out/'speech-v2.json'
    if asr.exists():speech=json.loads(asr.read_text(encoding='utf-8'))
    else:
        segments,info=model.transcribe(audio,beam_size=5,word_timestamps=True,condition_on_previous_text=False,
            initial_prompt='Preserve every spoken word, short reply, repetition and normal punctuation.',vad_filter=False)
        transcript=[]
        for s in segments:
            transcript.append(dict(id=len(transcript)+1,start_ms=round(s.start*1000),end_ms=round(s.end*1000),text=s.text.strip(),
                words=[dict(start_ms=round(w.start*1000),end_ms=round(w.end*1000),text=w.word) for w in s.words or []]))
        bounds=get_speech_timestamps(audio,VadOptions(min_silence_duration_ms=180,min_speech_duration_ms=120,speech_pad_ms=100,max_speech_duration_s=8))
        regions=[]
        for index,clip in enumerate(bounds):
            start=clip['start']/16000;end=clip['end']/16000
            segments,_=model.transcribe(audio[clip['start']:clip['end']],language=info.language,beam_size=5,
                word_timestamps=True,condition_on_previous_text=False,vad_filter=False)
            regions.append(dict(id=index+1,start_ms=round(start*1000),end_ms=round(end*1000),text=' '.join(s.text.strip() for s in segments)))
            progress('原音短句核对',58+round(10*(index+1)/len(bounds)))
        speech=dict(segments=transcript,speech_regions=regions,language=info.language)
        save(asr,speech)
    progress('识别逐帧硬字幕',70)
    ocr_file=out/'ocr-v2.json'
    if ocr_file.exists():ocr=json.loads(ocr_file.read_text(encoding='utf-8'))
    else:
        engine=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=2)
        cc=OpenCC('t2s');ocr=[]
        images=sorted((out/'subtitles').glob('*.jpg'))
        for index,image in enumerate(images):
            result,_=engine(str(image))
            lines=[dict(text=cc.convert(row[1]),score=float(row[2]),box=row[0]) for row in result or [] if row[2]>=.65]
            ocr.append(dict(time_ms=round((int(image.stem)-.5)*250),lines=lines))
            if index%12==0:progress('识别逐帧硬字幕',70+round(18*(index+1)/len(images)))
        save(ocr_file,ocr)
    # Collapse unchanged on-screen text while retaining each observed time interval.
    tracks=[]
    for row in ocr:
        text=' / '.join(line['text'] for line in row['lines'])
        if not text:continue
        if tracks and row['time_ms']-tracks[-1]['end_ms']<500 and difflib.SequenceMatcher(None,tracks[-1]['text'],text).ratio()>=.88:
            tracks[-1]['end_ms']=row['time_ms']+125
            if len(text)>len(tracks[-1]['text']):tracks[-1]['text']=text
        else:tracks.append(dict(start_ms=max(0,row['time_ms']-125),end_ms=row['time_ms']+125,text=text))
    import cv2
    import numpy as np
    caption_frames=[]
    for row in ocr:
        if not row['lines']:continue
        source=out/'subtitles'/f"{round(row['time_ms']/250+.5):06d}.jpg"
        image=cv2.imdecode(np.frombuffer(source.read_bytes(),np.uint8),cv2.IMREAD_COLOR)
        if image is None:continue
        preferred=[line for line in row['lines'] if re.search(r'[\u4e00-\u9fff]',line['text'])] or row['lines']
        top=max(0,int(min(point[1] for line in preferred for point in line['box']))-12)
        bottom=min(image.shape[0],int(max(point[1] for line in preferred for point in line['box']))+12)
        strip=image[top:bottom]
        if not strip.size:continue
        ok,encoded=cv2.imencode('.jpg',strip,[cv2.IMWRITE_JPEG_QUALITY,92])
        if ok:caption_frames.append(dict(time_ms=row['time_ms'],image='data:image/jpeg;base64,'+base64.b64encode(encoded).decode()))
    progress('建立全片人物与切镜画面证据',90)
    times=sorted(set(round((shot['start_ms']+shot['end_ms'])/2) for shot in base['shots']))
    profile=frame_panels(video,out,ffmpeg,times)
    import importlib.util
    spec=importlib.util.spec_from_file_location("voice_pitch",Path(__file__).with_name("voice-pitch.py"))
    pitch=importlib.util.module_from_spec(spec);spec.loader.exec_module(pitch)
    base["voice_pitch"]=pitch.measure(out/"audio.wav")
    base.update(speech)
    base.update(evidence_version=EVIDENCE_VERSION,caption_tracks=tracks,ocr_frames=ocr,caption_frames=caption_frames,profile_frames=profile,
                method='Whisper small + speech regions + 4fps OCR + consecutive face frames / v2')
    save(out/'result.json',base)
    progress('原音、字幕与人物画面准备完成',100)
    return base

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['video','out','ffmpeg']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--frame-request')
    args=parser.parse_args()
    request=json.loads(Path(args.frame_request).read_text(encoding='utf-8'))
    save(Path(args.frame_request).with_suffix('.result.json'),dict(frames=frame_panels(Path(args.video),Path(args.out),args.ffmpeg,request['times'])))
