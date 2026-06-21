import { marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

marked.use(gfmHeadingId());
console.log(marked.parse('### API Keys & Health tab'));
