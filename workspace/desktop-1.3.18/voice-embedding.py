"""Local speaker embeddings; these vectors never need to leave this machine."""
import argparse,json,os,re,uuid,wave
from pathlib import Path
import numpy as np
import sherpa_onnx

def words(text):return re.findall(r'[a-z0-9]+',text.lower().replace('’',"'"))

def extract(audio_file,model_file,prepared_file,items):
    with wave.open(str(audio_file),'rb') as source:
        if source.getframerate()!=16000 or source.getnchannels()!=1 or source.getsampwidth()!=2:
            raise ValueError('Expected 16 kHz mono PCM audio')
        audio=np.frombuffer(source.readframes(source.getnframes()),np.int16).astype(np.float32)/32768
    prepared=json.loads(Path(prepared_file).read_text(encoding='utf-8'))
    config=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(model_file),num_threads=2,provider='cpu')
    if not config.validate():raise ValueError('Speaker model configuration is invalid')
    engine=sherpa_onnx.SpeakerEmbeddingExtractor(config)
    output=[]
    for item in items:
        # Canonical VAD/ASR bounds prevent a short utterance's leading silence or
        # clipped final syllable from changing its identity between model runs.
        candidates=[region for region in prepared.get('speech_regions',[]) if words(region['text'])==words(item['en']) and abs((region['start_ms']+region['end_ms']-item['start_ms']-item['end_ms'])/2)<1200]
        region=min(candidates,key=lambda region:abs(region['start_ms']-item['start_ms'])) if candidates else item
        clip=audio[round(region['start_ms']*16):round(region['end_ms']*16)]
        if not len(clip):raise ValueError('Empty utterance audio')
        if len(clip)<16000:clip=np.tile(clip,int(np.ceil(16000/len(clip))))
        stream=engine.create_stream();stream.accept_waveform(16000,np.ascontiguousarray(clip));stream.input_finished()
        if not engine.is_ready(stream):raise ValueError('Utterance audio is too short')
        vector=np.asarray(engine.compute(stream),dtype=np.float64)
        norm=np.linalg.norm(vector)
        if not np.isfinite(norm) or norm<1e-9:raise ValueError('Invalid speaker embedding')
        output.append(dict(id=item['id'],start_ms=item['start_ms'],end_ms=item['end_ms'],audio_start_ms=region['start_ms'],audio_end_ms=region['end_ms'],canonical_region_id=region.get('id') if candidates else None,embedding=(vector/norm).tolist()))
    return dict(model=Path(model_file).name,algorithm_version=1,vectors=output)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for argument in ['audio','model','prepared','request']:parser.add_argument('--'+argument,required=True)
    args=parser.parse_args()
    request=Path(args.request);items=json.loads(request.read_text(encoding='utf-8'))['utterances']
    result=extract(args.audio,args.model,args.prepared,items)
    target=request.with_suffix('.result.json');temporary=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_text(json.dumps(result),encoding='utf-8');os.replace(temporary,target)
