export type RelationKind =
  | 'association'
  | 'dependency'
  | 'realization'
  | 'extends'
  | 'aggregation'
  | 'composition'
  | 'lollipop-left'
  | 'lollipop-right'
  | 'aggregation-both'
  | 'composition-both'
  | 'aggregation-to-comp'
  | 'composition-to-agg';

export interface ClassDef {
  id: string;
  display: string;
  stereotype?: string;
  attributes: string[];
  methods: string[];
}

export interface Relation {
  source: string;
  target: string;
  kind: RelationKind;
  label?: string;
  leftCard?: string;
  rightCard?: string;
}

export interface ClassModel {
  direction: 'TD' | 'TB' | 'LR' | 'RL' | 'BT';
  classes: ClassDef[];
  relations: Relation[];
  notes?: Array<{ target: string; text: string }>;
}
