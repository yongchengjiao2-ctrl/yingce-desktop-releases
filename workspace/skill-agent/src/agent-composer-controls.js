import {Z as reactModule,W as reactClient} from './vendor-react-DaNkUq-_.js';
import {n as ModelPicker,r as initModelPicker} from './model-picker-C8hI2N1a.js';
import {CreationSkillPicker} from './creation-skill-picker.js';
const React=reactModule();initModelPicker();
export function mountAgentControls(host,read){
  const root=reactClient().createRoot(host);
  const update=()=>{const c=read();root.render(React.createElement(React.Fragment,null,
    React.createElement(ModelPicker,{config:c.config,value:c.model,onChange:c.onModelChange,capability:'text',variant:'creation',showSelectedPrice:false,showOptionPrices:false,className:'ysa-native-model',disabled:c.disabled}),
    React.createElement(CreationSkillPicker,{conversationId:'agent:'+c.sessionId,value:c.skillIds,onChange:c.onSkillsChange,disabled:c.disabled})));
  };update();return{update,unmount:()=>root.unmount()};
}
