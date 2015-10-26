/// <amd-dependency path="SharedTS/content/SharedTS/browser/FirebaseRead.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/FirebaseReadShallow.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/syncUrl.js">
/// <amd-dependency path="SharedTS/content/SharedTS/browser/SyncVariable.js">

/// <amd-dependency path="SharedTS/content/SharedTS/browser/objIntegrate.js">

import Directive = require("SharedTS/content/SharedTS/browser/Directive");

import _ = require("underscore");
import angular = require("angular");
import Firebase = require("firebase");
import $ = require("jquery");

function hashCode(text: string) {
  var hash = 0, i, chr, len;
  if (text.length == 0) return hash;
  for (i = 0, len = text.length; i < len; i++) {
    chr   = text.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

function hsl(h, s, l) {
	return "hsl("+h+", " + s + "%, " + l + "%)";
}

function permute(arr: number[], curCount: number, maxCounts: number[]): number[][] {
	if(curCount >= maxCounts.length) return [arr];
	var max = maxCounts[curCount];
	var arrs = [];
	for(var ix = 0; ix < max; ix++) {
		var newArr = arr.slice(0);
		newArr.push(ix);
		permute(newArr, curCount + 1, maxCounts).forEach(newFullArr => {
			arrs.push(newFullArr);	
		});
	}
	return arrs;
}

function parseData(xml: string): Node[] {
	var xmlData = xmlIsDumb(dumbXMLParser(xml).obj, {});
	
	xmlData = xmlData["?xml"]["BIF"]["NETWORK"];
	
	//PROPERTY = "position = (7591.46923828125, 5166.06396484375)"
	var variables: { NAME: string, OUTCOME: string[], PROPERTY: string }[] = xmlData["VARIABLE"];
	var factors: { FOR: string, GIVEN: string[]|string, TABLE: string }[] = xmlData["DEFINITION"];
	
	var nodes: Node[] = variables.map(variableRAW => {
		var variable: Variable = {
			name: variableRAW.NAME,
			valuePossible: variableRAW.OUTCOME
		};
		var posParts = variableRAW.PROPERTY.split(new RegExp("(\\(|,| |\\)|=)+"));
		var posX = +posParts[2];
		var posY = +posParts[4];
		return {
			variable: variable,
			displayPos: {x: posX, y: posY},
			directFactors: {
				variables: []
			},
			parents: <any>{},
			children: <any>{},
			childDependent: <any>{}
		};
	});

	//Create node lookup
	var nodeLookup: { [name: string]: Node } = {};
	nodes.forEach(node => {
		nodeLookup[node.variable.name] = node; 
	});

	//Add factors
	factors.forEach(factor => {
		var given: string[] = <any>factor.GIVEN;
		given = given || [];
		if(!given["push"]) {
			given = <any>[given];
		}
		
		var givenVariables: Variable[] = given.map(name => nodeLookup[name].variable);
		var variableMaxes = givenVariables.map(x => x.valuePossible.length);
		var tableIndexes = permute([], 0, variableMaxes);

		var factorVariable = nodeLookup[factor.FOR].variable;
		var node = nodeLookup[factor.FOR];
		
		var tableValues = factor.TABLE.split(" ");
		for(var ix = 0; ix < tableValues.length; ix += factorVariable.valuePossible.length) {
			var chance: Chance = {
				valueChance: [],
				valuePossible: [],
				invalidFrac: 0
			};
			for(var iy = 0; iy < factorVariable.valuePossible.length; iy++) {
				chance.valueChance.push(+tableValues[ix + iy]);
				chance.valuePossible.push(factorVariable.valuePossible[iy]);
			}
			
			var tableIndex = tableIndexes[ix / factorVariable.valuePossible.length];
			var values = tableIndex.map((valueIndex, varIndex) => {
				var variable = givenVariables[varIndex];
				return { name: variable.name, valueIndex: valueIndex, valuePossible: variable.valuePossible };
			});
			node.directFactors.variables.push({
				chance: chance,
				values: values
			}); 
		}
	});
	
	//Populate parents and children
	nodes.forEach(node => {
		node.directFactors.variables[0].values.forEach(value => {
			var parentNode = nodeLookup[value.name];
			node.parents[parentNode.variable.name] = parentNode;
			parentNode.children[node.variable.name] = node;
		});
	});
	
	return nodes;
}

function parseUntil(pos: number, text: string, ch: string|RegExp) {
	var regExp = typeof ch === "object";
	var reg = <RegExp>ch;
	while(pos < text.length) {
		if(regExp && reg.exec(text[pos])) return pos;
		if(!regExp && text[pos] === ch) return pos;
		pos++;
	}
	return pos;
}
function parseUntilMultiple(pos: number, text: string, chs: (string|RegExp)[]) {
	for(var ix = 0; ix < chs.length; ix++) {
		pos = parseUntil(pos, text, chs[ix]);
	}
	return pos;
}


interface XMLObj {
	name: string;
	children: XMLObj[];
	value: string;
}

interface Variable {
	name: string;
	valueIndex?: number;
	valuePossible: string[];
}

interface Chance {
	valueChance: number[];
	valuePossible: string[];
	invalidFrac: number;
}

interface Factors {
	//Hmm... might want to index this in some way...
	//	but is that really needed?
	variables: {values: Variable[], chance: Chance}[];
}

interface Node {
	variable: Variable;
	
	directFactors: Factors;
	displayPos: {x: number; y: number};
	
	parents: {[name:string]: Node};
	children: {[name:string]: Node};
	
	//Is relevant if it is set (which it may not be)
	isPotentialRelevant?: boolean;
	//Is relevant right now (so a parent is usually relevant even if not)
	isRelevant?: boolean;
	
	absoluteChance?: Chance;
}

function enumerateNodesChildren(node: Node, fnc: (node: Node) => void) {
	var visited: { [name: string]: boolean } = {};	
	var toVisit: Node[] = [];
	toVisit.push(node);
	visited[node.variable.name] = true;
	while (toVisit.length > 0) {
		var node = toVisit.splice(0, 1)[0];
		fnc(node);
		_.values(node.children).forEach((neighbour: Node) => {
			if(neighbour.variable.name in visited) return;
			visited[neighbour.variable.name] = true;
			toVisit.push(neighbour);
		});
	}
}

//down is true, if we just traveled downwards (so to a child)
function enumerateNodes(startNode: Node, fnc: (node: Node, down?: boolean) => void|boolean, justChildren?: boolean, justParents?: boolean, skipFirst?: boolean) {
	var visited: { [name: string]: boolean } = {};	
	var toVisit: {n: Node, down: boolean}[] = [];
	toVisit.push({n: startNode, down: true});
	visited[startNode.variable.name] = true;
	while (toVisit.length > 0) {
		var nodeObj = toVisit.splice(0, 1)[0];;
		var node = nodeObj.n;
		if(!skipFirst || node !== startNode) {
			var returnVal = fnc(node, nodeObj.down);
			if(returnVal === false) continue;
		}
		var neighbours: {n: Node, down: boolean}[] = [];
		if(!justParents) {
			neighbours = neighbours.concat(
				_.values(node.children).map(n => {return {n: n, down: true}})
			);
		}
		if(!justChildren) {
			neighbours = neighbours.concat(
				_.values(node.parents).map(n => {return {n: n, down: false}})
			);
		}
		neighbours.forEach((neighbourObj) => {
			var neighbour = neighbourObj.n;
			if(neighbour.variable.name in visited) return;
			visited[neighbour.variable.name] = true;
			toVisit.push(neighbourObj);
		});
	}
}

function getNodes(node: Node, fnc: (node: Node) => boolean): { [name: string]: Node } {
	var nodes: { [name: string]: Node } = {};
	enumerateNodes(node, n => {
		if (fnc(n)) {
			nodes[n.variable.name] = n;
		}
	});
	return nodes;
}

function getRoots(node: Node): { [name: string]: Node } {
	return getNodes(node, n => _.isEmpty(n.parents));
}

function normalizeChances(chances: number[]): number[] {
	var sum = 0;
	chances.forEach(x => sum += x || 0);
	return chances.map(x => x / sum);
}

function simulateOnce(target: Node, roots: { [name: string]: Node }): string {
	var toVisit: Node[] = _.map(roots, x => x);
	//var visited: { [name: string]: boolean } = {};
	var values: { [name: string]: string } = {};
	var visited: { [name: string]: boolean } = {};
	_.forEach(roots, x => {
		visited[x.variable.name] = true;
	});
	while(toVisit.length > 0) {
		var node = toVisit.splice(0, 1)[0];
		//Calculate our value
		var chances = node.directFactors.variables.filter(varChance => {
			return _.all(varChance.values, variable => {
				var outcome = variable.valuePossible[variable.valueIndex];
				return values[variable.name] === outcome;
			});
		});
		var chance = chances[0].chance;
		
		var cdf = [];
		var sum = 0;
		
		var p = Math.random();
		
		var index = 0;
		
		var idk = normalizeChances(chance.valueChance);
		for(var k in idk) {
			var frac = idk[k];
			if(p < sum) {
				break;
			}
			index = +k;
			sum += frac;
		}
		
		if(node.variable.valueIndex !== undefined) {
			if(node.variable.valueIndex !== index) {
				return null;
			}
		}
		
		values[node.variable.name] = node.variable.valuePossible[index];

		//Check if any children can now be triggered (and have not been visited)
		_.forEach(node.children, child => {
			if(child.variable.name in values) {
				throw new Error("Uh... triggered twice?");
			}
			if(_.all(child.parents, c => c.variable.name in values)) {
				toVisit.push(child);
				visited[child.variable.name] = true;
			}
		});
	}
	
	return values[target.variable.name];
}

function factorOf(
	node: Node,
	values: { [name: string]: string },
	oneOnMissingValue: boolean
): number {
	var name = node.variable.name;
	if(node.variable.valueIndex !== undefined) {
		var value = node.variable.valuePossible[node.variable.valueIndex];
		if(value !== values[name]) {
			//Hmm... I don't think this should happen
			debugger;
		}
		
		//It might influence another variable, which take a different path to influence us
		//return 1;
	}
	
	var matches = node.directFactors.variables.filter(variable =>
		_.all(variable.values, value => value.valuePossible[value.valueIndex] === values[value.name]) 
	);
	if(matches.length !== 1) {
		if(oneOnMissingValue) {
			return 1;
		}
		throw new Error("Invalid numbers of matches, this means values is incomplete.");
		//Should not happen, it means there are either no matches (likely a node that is considered
		//	relevant, while some of its parents are not), or there are multiple matches (how could that happen?)
	}
	
	var chance = matches[0].chance;
	var currentIndex = -1;
	
	chance.valuePossible.forEach((possible, index) => {
		if(possible === values[node.variable.name]) {
			currentIndex = index;
		}
	});
	
	return chance.valueChance[currentIndex];
}

function chanceOf(
	nodeLookup: { [name: string]: Node },
	values: { [name: string]: string },
	//If it is correct in any cases where we can't find a value needed to get a factor, we skip the factor.
	//	Otherwise we will throw errors if we think it has problems.
	valuesIsCorrect: boolean
): number {
	/*
C B A
T T T  0.5 * 0.9 * 0.7 = 0.315
T T F  0.5 * 0.9 * 0.3 = 0.135
T F T  0.5 * 0.1 * 0.4 = 0.020
T F F  0.5 * 0.1 * 0.6 = 0.030
F T T  0.5 * 0.4 * 0.7 = 0.140
F T F  0.5 * 0.4 * 0.3 = 0.060
F F T  0.5 * 0.6 * 0.4 = 0.120
F F F  0.5 * 0.6 * 0.6 = 0.180

(P(C, B, A) + P(!C, B, A)) / (P(C, B, A) + P(!C, B, A) + P(C, !B, A) + P(!C, !B, A))
(P(C, B, A) + P(!C, B, A)) / P(A = T)
(P(C, B, A) + P(!C, B, A)) / P(A = T)

P(B=T) = P(C, B, A) + P(C, B, !A) + P(!C, B, A) + P(!C, B, !A) = 0.65
B(B=T|A=T) = 0.765

P(A=T) = 0.595
	*/
	
	var chance = 1;
	_.forEach(values, (value, name) => {
		chance *= factorOf(nodeLookup[name], values, valuesIsCorrect);
	});
	return chance;
}

function calculate(
	node: Node, 
	relevantNodes: Node[], 
	nodeLookup: { [name: string]: Node },
	relevantIsCorrect?: boolean
): Chance {
	//relevantNodes = [ nodeLookup["H"] ];
	
	var outcomes: { [outcome: string]: number } = {};
	
	if(node.variable.valueIndex !== undefined) {
		outcomes[node.variable.valuePossible[node.variable.valueIndex]] = 1;
	} else {
	
		relevantNodes = relevantNodes.filter(x => x !== node);
		var unsetNodes = relevantNodes.filter(x => x.variable.valueIndex === undefined);
		var setNodes = relevantNodes.filter(x => x.variable.valueIndex !== undefined);
		
		//Permute all values of unsetNodes
		var relevantVariables: Variable[] = unsetNodes.map(node => node.variable);
		var variableMaxes = relevantVariables.map(x => x.valuePossible.length);
		var variableIndexes = permute([], 0, variableMaxes);
		variableIndexes.forEach(indexes => {
			var values: { [name: string]: string } = {};
			indexes.forEach((valueIndex, variableIndex) => {
				var variable = relevantVariables[variableIndex];
				var value = variable.valuePossible[valueIndex];
				values[variable.name] = value;
			});
			setNodes.forEach(setNode => {
				var variable = setNode.variable; 
				values[variable.name] = variable.valuePossible[variable.valueIndex];
			});
			//Permute all values of node
			var nodeName = node.variable.name;
			node.variable.valuePossible.forEach(nodeValue => {
				values[nodeName] = nodeValue;
				outcomes[nodeValue] = outcomes[nodeValue] || 0;
				outcomes[nodeValue] += chanceOf(nodeLookup, values, relevantIsCorrect);
			});
		});
	}
	
	var dist = node.variable.valuePossible.map(outcome => outcomes[outcome] || 0);
	
	return { 
		valueChance: normalizeChances(dist), 
		valuePossible: node.variable.valuePossible,
		invalidFrac: 0
	};
}

function getAbsoluteChance(node: Node, simulations: number): Chance {
	//Get the absolute chances of our parents
	
	var outcomes: { [outcome: string]: number } = {};
	
	var invalidCount = 0;
	
	var roots = getRoots(node);
	
	for(var ix = 0; ix < simulations; ix++) {
		var outcome = simulateOnce(node, roots);
		if(outcome === null) {
			invalidCount++;
			continue;
		}
		outcomes[outcome] = outcomes[outcome] || 0;
		outcomes[outcome]++;
	}
	
	var dist = node.variable.valuePossible.map(outcome => outcomes[outcome] || 0);
	
	return { 
		valueChance: normalizeChances(dist), 
		valuePossible: node.variable.valuePossible,
		invalidFrac: invalidCount / simulations
	};
}

function setChildDependents(node: Node) {
	_.forEach(node.children, node => {
		if(node.variable.valueIndex !== undefined) {
			
		}
	});
}

function chanceToString(chance: Chance): string {
	var parts = [];
	chance.valueChance.forEach((x, index) => {
		parts.push(chance.valuePossible[index] + "=" + chance.valueChance[index].toFixed(10));
	});
	return parts.join(" ");
}

function chanceEqual(a: Chance, b: Chance): boolean {
	return chanceToString(a) === chanceToString(b);
}

class Base extends Directive {
	public templateUrl = "main/main.html";
	public cssUrl = "main/main.css";
	
	public data: Node[];
	public nodeLookup: { [name: string]: Node };
	
	public minX: number;
	public maxX: number;
	public minY: number;
	public maxY: number;
	
	public nodeWidth = 0.25;
	public nodeHeight = 0.25;
	
	public showFactors = true;
	public showChances = true;
	
	public selectedNode: Node;
	
	public simulationCount: number = 25000;
	
	public checkCount: number = 10;
	
	public unobserveAll() {
		this.data.forEach(n => {
			n.variable.valueIndex = undefined;
		});
	}
	
	public num(x) {
		var epsilon = 1000000;
		return Math.round(x * epsilon) / epsilon;
	}
	
	public observeRandom() {
		this.unobserveAll();
		//Eh.. sort of, but not really, because I am lazy
		var observeCount = ~~(Math.random() * this.data.length);
		while(observeCount --> 0) {
			var pos = ~~(Math.random() * this.data.length);
			var node = this.data[pos];
			if(node.variable.valueIndex !== undefined) continue;
			node.variable.valueIndex = ~~(Math.random() * node.variable.valuePossible.length);
		}
	}
	public calculateAll() {
		this.data.forEach(n => {
			this.calculateChanceHeuristic(n);
		});
	}
	public checkNTimes(N: number) {
		for(var ix = 0; ix < N; ix++) {
			this.observeRandom();
			this.calculateAll();
		}
	}
	
	public selectNode(node: Node) {
		console.log(node);
		
		this.data.forEach(n => n.isRelevant = false);
		this.data.forEach(n => n.isPotentialRelevant = false);
		
		if(this.selectedNode === node) {
			this.selectedNode = null;
		} else {
			this.selectedNode = node;
		}
	}
	
	public simulateChance(node: Node) {
		node.absoluteChance = getAbsoluteChance(node, this.simulationCount);
	}
	
	//These should really also adjust the probabilities on the nodes, as it may be that removing them has no effect,
	//	but that in general it would, it just happens to be that the current probabilities exactly work out. 
	
	public markPotentialRelevant(node: Node) {
		this.data.forEach(n => n.isRelevant = false);
		this.data.forEach(n => n.isPotentialRelevant = false);
		
		//See which nodes we can toggle in order to get a change in chance
		var nodes = this.data.slice();
		
		var baseChance = calculate(node, nodes, this.nodeLookup);
		
		for(var ix = 0; ix < nodes.length; ix++) {
			var testNode = nodes[ix];
			if(testNode === node) continue;
			var testVariable = testNode.variable;
			
			testNode.isPotentialRelevant = false;
			
			//Try all values to see if any of them change the chance
			var startIndex = testVariable.valueIndex;
			testVariable.valueIndex = undefined;
			try {
				var testChance = calculate(node, nodes, this.nodeLookup);
				if(!chanceEqual(baseChance, testChance)) {
					testNode.isPotentialRelevant = true;
					continue;
				}
				for (var index = 0; index < testVariable.valuePossible.length; index++) {
					testVariable.valueIndex = index;
					var testChance = calculate(node, nodes, this.nodeLookup);
					if(!chanceEqual(baseChance, testChance)) {
						testNode.isPotentialRelevant = true;
						break;
					}
				}
			} finally {
				testVariable.valueIndex = startIndex;
			}
		}
	}
	
	public markRelevant(node: Node) {
		this.data.forEach(n => n.isRelevant = false);
		
		this.markPotentialRelevant(node);
		
		//See which nodes we can remove in order to get a change in chance
		var nodes = this.data.slice();
		
		var baseChance = calculate(node, nodes, this.nodeLookup);
		
		for(var ix = 0; ix < nodes.length; ix++) {
			var testNode = nodes[ix];
			if(testNode === node) continue;
			var testVariable = testNode.variable;
			
			testNode.isRelevant = false;
			
			if(!testNode.isPotentialRelevant) continue;
		
			var nodesToRemove: { [name: string]: boolean } = {};
			nodesToRemove[testNode.variable.name] = true;
		
			//Remove testNode, and all descendants, up until descendants that are set
			enumerateNodes(testNode, descendant => {
				if(descendant.variable.valueIndex !== undefined) {
					return false;
				}
				nodesToRemove[descendant.variable.name] = true;
			}, true);
			
			var subNodes = nodes.filter(n => !nodesToRemove[n.variable.name]);
			
			try {
				var testChance = calculate(node, subNodes, this.nodeLookup);
				testNode.isRelevant = !chanceEqual(baseChance, testChance);
			} catch(err) {
				//Eh... means we can't calculate the chance without it... so it IS relevant
				testNode.isRelevant = true;
			}
		}
		
		this.data.forEach(n => n.isPotentialRelevant = false);
	}
	
	public markHeuristicRelevant(node: Node) {
		this.data.forEach(n => n.isRelevant = false);
		this.data.forEach(n => n.isPotentialRelevant = false);
		
		//We should really use this heuristic... but I probably won't
		//If parent(s) are independent, you can calculate their probabilities and go from those
		//	They could be independent as a nature of the graph, OR they could be known values
		
		//Parents are relevant, up to observed value
		//Descendants of a parent that are observed (and the chain to them) are relevant
		//	If the ancestors of an observed contain an ancestor of the target, all the ancestors are relevant
		//But always, if the connection is only through an observed node, it doesn't count
		
		var allRelevant: { [name: string]: Node } = {};
		
		//Explicitly removed from other lists, as everywhere we check for existence
		//	we will be screening out observed anyway.
		var observedRelevant: { [name: string]: Node } = {};
		
		//Ancestors from node
		var ancestors: { [name: string]: Node } = {};
		enumerateNodes(node, parent => {
			var parentName = parent.variable.name;
			allRelevant[parentName] = parent;
			if(parent.variable.valueIndex !== undefined) {
				observedRelevant[parentName] = parent;
				return false;
			}
			ancestors[parentName] = parent;
		}, false, true);
		
		//Connected to node, but not blocked by other observed (or an observed itself)
		var connectedObserved: { [name: string]: Node } = {};
		enumerateNodes(node, (connected, down) => {
			if(connected.variable.valueIndex !== undefined) {
				connectedObserved[connected.variable.name] = connected;
				
				if(!down) { 
					return false;
				}
			}
		});
		
		//Observed yield potential chains, but that are not relevant unless one is an ancestor of the target?
		var ancestorsChanged = true;
		while(ancestorsChanged) { //Oh crap... this makes this whole thing a lot less efficient...
			ancestorsChanged = false;
			_.forEach(connectedObserved, (observed, observedName) => {
				var observedAncestors: { [name: string]: Node } = {};
				observedAncestors[observedName] = observed;
				var relevant = false;
				enumerateNodes(observed, connected => {
					var connectedName = connected.variable.name;
					observedAncestors[connectedName] = connected;
					if(connected.variable.valueIndex !== undefined) return false;
					if(ancestors[connectedName]) {
						relevant = true;
						return false;
					}
				}, false, true, true);
				if(relevant) {
					ancestorsChanged = true;
					delete connectedObserved[observedName];
					_.forEach(observedAncestors, (x, y) => {
						ancestors[y] = x;
						allRelevant[y] = x;
					});
				}
			});
		}
		
		delete allRelevant[node.variable.name];
		
		_.forEach(allRelevant, (node, name) => {
			node.isRelevant = true;
		});
	}
	
	public calculateChanceBruteForce(node: Node) {
		var chance = calculate(node, this.data, this.nodeLookup);
		node.absoluteChance = chance;
	}
	
	public calculateChanceHeuristic(node: Node) {
		console.log("Calculing heuristic for " + node.variable.name);
		
		/*
		console.time("Calc Relevant Brute Force");
		this.markRelevant(node);
		//Audit ourself, so we never mess up
		var relevantNodes: { [name: string]: boolean } = {};
		enumerateNodes(node, n => {
			if(n.isRelevant) {
				relevantNodes[n.variable.name] = true;
			}
		});
		console.timeEnd("Calc Relevant Brute Force");
		*/
		
		
		console.time("Calc Heuristic");
		this.markHeuristicRelevant(node);
		var relevant: Node[] = [];
		var realRelevant: { [name: string]: Node } = {};
		enumerateNodes(node, n => {
			if(n.isRelevant) {
				relevant.push(n);
				realRelevant[n.variable.name] = n;
			}
		});
		var chance = calculate(node, relevant, this.nodeLookup, true);
		node.absoluteChance = chance;
		console.timeEnd("Calc Heuristic");
				
				
		/*
		console.time("Audit Heuristic");
		_.forEach(realRelevant, (n, name) => {
			if(!relevantNodes[name]) {
				debugger;
				throw new Error("Incorrectly said " + name + " was relevant");
			}
		});
		_.forEach(relevantNodes, (k, name) => {
			if(!(name in realRelevant)) {
				debugger;
				throw new Error("Missed relevant " + name);
			}
		});
		console.timeEnd("Audit Heuristic");
		*/
		
		
		console.time("Brute force calculate");
		var realChance = calculate(node, this.data, this.nodeLookup);
		console.timeEnd("Brute force calculate");
		
		if(!chanceEqual(chance, realChance)) {
			throw new Error("Heuristics provided wrong chance");
		}
	}
	
	public calculateChance(node: Node) {
		//Find nodes that are definitely not relevant
		
		//If there are nodes that have no set children, I am fairly sure 
	}
	
	public xPos(x: number) {
		return this.width(x - this.minX);
	}
	public width(w: number) {
		return w / ((this.maxX - this.minX) * (1 + this.nodeWidth));
	}
	public yPos(y: number) {
		return this.height(y - this.minY);
	}
	public height(h: number) {
		return h / ((this.maxY - this.minY) * (1 + this.nodeHeight));
	}
	public adjNodeWidth() {
		return this.nodeWidth / (1 + this.nodeWidth);
	}
	public adjNodeHeight() {
		return this.nodeHeight / (1 + this.nodeHeight);
	}
	
	construct() {
		this.loadData(xml);
	}
	
	public loadData(xml: string) {
		this.data = parseData(xml);
		this.nodeLookup = {};
		this.data.forEach(node => {
			this.nodeLookup[node.variable.name] = node;
		});
		
		this.minX = _.min(this.data.map(a => a.displayPos.x));
		this.minY = _.min(this.data.map(a => a.displayPos.y));
		
		this.maxX = _.max(this.data.map(a => a.displayPos.x));
		this.maxY = _.max(this.data.map(a => a.displayPos.y));
		
		this.safeApply();
	}
	
	public countKeys(obj) {
		var count = 0;
		for(var key in obj) count++;
		return count;
	}
	public max(obj, key) {
		var fnc = key && (k => k[key]);
		return _.max(obj, fnc);
	}
	public min(obj, key) {
		var fnc = key && (k => k[key]);
		return _.min(obj, fnc);
	}
	public isDefined(x) {
		return x !== undefined;
	}
	
	public mostRecent(obj, key, count) {
		var arr = _.map(obj, _.identity);
		arr.sort((a, b) => {
			if(a[key] < b[key]) {
				return -1;
			} else if(a[key] < b[key]) {
				return +1;
			}
			return 0;
		});
	}
	
	public flatten(obj) {
		var arr = [];
		_.forEach(obj, x => _.forEach(<any>x, k => arr.push(k)));
		return arr;
	}
	
	public select(obj, key) {
		return _.map(obj, x => x[key]);
	}
	
	public getColor(text) {
		return hsl(hashCode(text) % 360, 75, 75);
	}
	
	public keys(obj) {
		return _.keys(obj);
	}
}

var mod = angular.module("Base", ["FirebaseRead", "syncUrl", "SyncVariable", "objIntegrate", "FirebaseReadShallow"]);
mod.directive("base", function() {
	return <any>(new Base().createScope());
});

mod.filter('reverse', function () {
	return function (items) {
		return items.slice().reverse();
	};
});

mod.filter('sort', function () {
	return function (items) {
		items = items.slice();
		items.sort();
		return items;
	};
});

var arr = [];

//Makes everything into properties, unless there are duplicates, then uses arrays. Arrays should
//	just be explicit anyway, any format with implicit arrays is stupid (or any format with everything being
//	arrays, just because it doesn't want to specify what is actually an array).
function xmlIsDumb(obj: XMLObj, holder: any) {
	var childObj = {};
	
	obj.children.forEach(child => {
		xmlIsDumb(child, childObj);
	});
	
	if(obj.value) {
		childObj = obj.value;
	}
	
	if(obj.name in holder) {
		if(holder[obj.name].constructor !== arr.constructor) {
			holder[obj.name] = [holder[obj.name]];
		}
		holder[obj.name].push(childObj);
	} else {
		holder[obj.name] = childObj;
	}
	
	return holder;
}

function dumbXMLParser(xml: string, posIn?: number): {obj: XMLObj; pos: number} {
	var ret = {obj: <XMLObj>{ children: [] }, pos: posIn || 0};
	
	//Start
	ret.pos = parseUntil(ret.pos, xml, "<");
	
	var nameStart = ret.pos + 1;
	//Name
	ret.pos = parseUntil(ret.pos, xml, new RegExp("( |>)"));
	var nameEnd = ret.pos;
	var name = xml.substring(nameStart, nameEnd);
	
	ret.obj.name = name;
	
	//Would parse properties here
	
	//Parse children
	ret.pos = parseUntil(ret.pos, xml, ">");
	if(xml[ret.pos - 1] === "/") return ret;
	
	var valueStart = ret.pos + 1;
	
	while(true) {
		ret.pos = parseUntil(ret.pos, xml, "<");
	
		//TODO: Actually check if it ends us (which would mean read the name of it)	
		if(xml[ret.pos + 1] === "/" || ret.pos >= xml.length) {
			if(ret.obj.children.length === 0) {
				ret.obj.value = xml.substring(valueStart, ret.pos);
			}
			ret.pos++;
			return ret;
		}
		
		var result = dumbXMLParser(xml, ret.pos);
		ret.pos = result.pos;
		
		ret.obj.children.push(result.obj);
	}
	
	return ret;
}


var test = dumbXMLParser(`
<?xml version="1.0" encoding="UTF-8"?>
<BIF VERSION="0.3"  xmlns="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd">
<NETWORK>
<NAME>Conditional Independence Quiz</NAME>
<PROPERTY>detailed = </PROPERTY>
<PROPERTY>short = The conditional independence quiz is not intended to be a network used for querying, but is a graph useful for thinking about conditional independence questions.</PROPERTY>

<VARIABLE TYPE="nature">
	<NAME>A</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7260.90625, 5272.43896484375)</PROPERTY>
</VARIABLE>
`);
console.log(test);

window["parse"] = dumbXMLParser;

var xml = `
<?xml version="1.0" encoding="UTF-8"?>
<BIF VERSION="0.3"  xmlns="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd">
<NETWORK>
<NAME>Conditional Independence Quiz</NAME>
<PROPERTY>detailed = </PROPERTY>
<PROPERTY>short = The conditional independence quiz is not intended to be a network used for querying, but is a graph useful for thinking about conditional independence questions.</PROPERTY>

<VARIABLE TYPE="nature">
	<NAME>A</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7260.90625, 5272.43896484375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>B</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7316.806640625, 5170.416015625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>C</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7401.22900390625, 5048.64990234375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>D</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7392.3115234375, 5284.9638671875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>E</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7468.1103515625, 5166.06396484375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>F</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7527.560546875, 5281.9912109375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>G</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7591.46923828125, 5166.06396484375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>H</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7659.83642578125, 5287.93603515625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>I</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7588.49658203125, 5405.35009765625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>J</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7740.09423828125, 5169.0361328125)</PROPERTY>
</VARIABLE>

<DEFINITION>
	<FOR>A</FOR>
	<GIVEN>B</GIVEN>
	<TABLE>0.7 0.3 0.4 0.6</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>B</FOR>
	<GIVEN>C</GIVEN>
	<TABLE>0.9 0.1 0.4 0.6</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>C</FOR>
	<TABLE>0.5 0.5</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>D</FOR>
	<GIVEN>B</GIVEN>
	<GIVEN>E</GIVEN>
	<TABLE>0.3 0.7 0.5 0.5 0.2 0.8 0.9 0.1</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>E</FOR>
	<GIVEN>C</GIVEN>
	<TABLE>0.7 0.3 0.2 0.8</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>F</FOR>
	<GIVEN>E</GIVEN>
	<GIVEN>G</GIVEN>
	<TABLE>0.9 0.1 0.2 0.8 0.4 0.6 0.7 0.3</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>G</FOR>
	<TABLE>0.2 0.8</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>H</FOR>
	<GIVEN>G</GIVEN>
	<GIVEN>J</GIVEN>
	<TABLE>0.8 0.2 0.3 0.7 0.5 0.5 0.1 0.9</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>I</FOR>
	<GIVEN>H</GIVEN>
	<TABLE>0.8 0.2 0.1 0.9</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>J</FOR>
	<TABLE>0.3 0.7</TABLE>
</DEFINITION>
</NETWORK>
</BIF>
`;

xml = `
<?xml version="1.0" encoding="UTF-8"?>
<BIF VERSION="0.3"  xmlns="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd">
<NETWORK>
<NAME>Untitled</NAME>
<PROPERTY>detailed = </PROPERTY>
<PROPERTY>short = </PROPERTY>

<VARIABLE TYPE="nature">
	<NAME>Node 0</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7690.0, 5344.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 1</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7682.0, 5263.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 2</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7647.0, 5188.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 3</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7560.0, 5344.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 4</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7544.0, 5269.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 5</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7493.0, 5190.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 6</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7435.0, 5340.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 7</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7438.0, 5252.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>Node 8</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7387.0, 5187.0)</PROPERTY>
</VARIABLE>

<DEFINITION>
	<FOR>Node 0</FOR>
	<GIVEN>Node 1</GIVEN>
	<TABLE>0.1 0.9 0.2 0.8</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 1</FOR>
	<GIVEN>Node 2</GIVEN>
	<TABLE>0.3 0.7 0.4 0.6</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 2</FOR>
	<TABLE>0.8 0.2</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 3</FOR>
	<GIVEN>Node 4</GIVEN>
	<TABLE>0.4 0.6 0.9 0.1</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 4</FOR>
	<GIVEN>Node 2</GIVEN>
	<GIVEN>Node 5</GIVEN>
	<TABLE>0.23 0.77 0.67 0.33 0.64 0.36 0.32 0.68</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 5</FOR>
	<TABLE>0.87 0.13</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 6</FOR>
	<GIVEN>Node 7</GIVEN>
	<TABLE>0.9 0.1 0.7 0.3</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 7</FOR>
	<GIVEN>Node 5</GIVEN>
	<GIVEN>Node 8</GIVEN>
	<TABLE>0.1 0.9 0.4 0.6 0.4 0.6 0.7 0.3</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>Node 8</FOR>
	<TABLE>0.1 0.9</TABLE>
</DEFINITION>
</NETWORK>
</BIF>

`;


xml = `
<?xml version="1.0" encoding="UTF-8"?>
<BIF VERSION="0.3"  xmlns="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
	xsi:schemaLocation="http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3 http://www.cs.ubc.ca/labs/lci/fopi/ve/XMLBIFv0_3/XMLBIFv0_3.xsd">
<NETWORK>
<NAME>Electrical Diagnosis Problem</NAME>
<PROPERTY>detailed = This example models the problem of diagnosing the electrical system of a house. This is Figure 6.2 and Example 6.11 of Poole and Mackworth, Artificial Intelligence: foundations of computational agents. Copyright Poole and Mackworth, 2010. This may be used under a Creative Commons Attribution-Noncommercial-Share Alike 2.5 Canada License http://creativecommons.org/licenses/by-nc-sa/2.5/ca/</PROPERTY>
<PROPERTY>short = Electrical Diagnosis Example of Poole and Mackworth, Artificial Intelligence.</PROPERTY>

<VARIABLE TYPE="nature">
	<NAME>outside_power</NAME>
	<OUTCOME>on</OUTCOME>
	<OUTCOME>off</OUTCOME>
	<PROPERTY>position = (7611.4013671875, 5048.01123046875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>cb1_st</NAME>
	<OUTCOME>on</OUTCOME>
	<OUTCOME>off</OUTCOME>
	<PROPERTY>position = (7428.17236328125, 5095.05615234375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w3</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7517.310546875, 5129.72119140625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>cb2_st</NAME>
	<OUTCOME>on</OUTCOME>
	<OUTCOME>off</OUTCOME>
	<PROPERTY>position = (7716.63330078125, 5098.77001953125)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w6</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7639.87548828125, 5156.95751953125)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>p2</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7693.10986328125, 5259.7138671875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>p1</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7589.11669921875, 5256.0)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s1_st</NAME>
	<OUTCOME>ok</OUTCOME>
	<OUTCOME>upside_down</OUTCOME>
	<OUTCOME>short</OUTCOME>
	<OUTCOME>intermittent</OUTCOME>
	<OUTCOME>broken</OUTCOME>
	<PROPERTY>position = (7445.5048828125, 5184.1943359375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s1_pos</NAME>
	<OUTCOME>up</OUTCOME>
	<OUTCOME>down</OUTCOME>
	<PROPERTY>position = (7362.556640625, 5186.669921875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w1</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7400.9365234375, 5267.14208984375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w2</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7487.59765625, 5264.66650390625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w0</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7446.7431640625, 5355.04248046875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s2_st</NAME>
	<OUTCOME>ok</OUTCOME>
	<OUTCOME>upside_down</OUTCOME>
	<OUTCOME>short</OUTCOME>
	<OUTCOME>intermittent</OUTCOME>
	<OUTCOME>broken</OUTCOME>
	<PROPERTY>position = (7357.60498046875, 5315.42529296875)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s2_pos</NAME>
	<OUTCOME>up</OUTCOME>
	<OUTCOME>down</OUTCOME>
	<PROPERTY>position = (7356.36669921875, 5382.27880859375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>l1_lit</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7461.59912109375, 5463.98828125)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>w4</NAME>
	<OUTCOME>live</OUTCOME>
	<OUTCOME>dead</OUTCOME>
	<PROPERTY>position = (7575.49853515625, 5347.6142578125)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s3_pos</NAME>
	<OUTCOME>up</OUTCOME>
	<OUTCOME>down</OUTCOME>
	<PROPERTY>position = (7620.0673828125, 5303.04541015625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>s3_st</NAME>
	<OUTCOME>ok</OUTCOME>
	<OUTCOME>upside_down</OUTCOME>
	<OUTCOME>short</OUTCOME>
	<OUTCOME>intermittent</OUTCOME>
	<OUTCOME>broken</OUTCOME>
	<PROPERTY>position = (7699.30078125, 5350.09033203125)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>l2_lit</NAME>
	<OUTCOME>T</OUTCOME>
	<OUTCOME>F</OUTCOME>
	<PROPERTY>position = (7613.876953125, 5451.6083984375)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>l2_st</NAME>
	<OUTCOME>ok</OUTCOME>
	<OUTCOME>intermittent</OUTCOME>
	<OUTCOME>broken</OUTCOME>
	<PROPERTY>position = (7693.10986328125, 5414.46728515625)</PROPERTY>
</VARIABLE>

<VARIABLE TYPE="nature">
	<NAME>l1_st</NAME>
	<OUTCOME>ok</OUTCOME>
	<OUTCOME>intermittent</OUTCOME>
	<OUTCOME>broken</OUTCOME>
	<PROPERTY>position = (7524.73876953125, 5415.70556640625)</PROPERTY>
</VARIABLE>

<DEFINITION>
	<FOR>outside_power</FOR>
	<TABLE>0.98 0.02</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>cb1_st</FOR>
	<TABLE>0.999 0.001</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w3</FOR>
	<GIVEN>outside_power</GIVEN>
	<GIVEN>cb1_st</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>cb2_st</FOR>
	<TABLE>0.999 0.001</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w6</FOR>
	<GIVEN>outside_power</GIVEN>
	<GIVEN>cb2_st</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>p2</FOR>
	<GIVEN>w6</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>p1</FOR>
	<GIVEN>w3</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s1_st</FOR>
	<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s1_pos</FOR>
	<TABLE>0.5 0.5</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w1</FOR>
	<GIVEN>w3</GIVEN>
	<GIVEN>s1_st</GIVEN>
	<GIVEN>s1_pos</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 0.6 0.4 0.4 0.6 0.4 0.6 0.01 0.99 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w2</FOR>
	<GIVEN>w3</GIVEN>
	<GIVEN>s1_st</GIVEN>
	<GIVEN>s1_pos</GIVEN>
	<TABLE>0.0 1.0 1.0 0.0 1.0 0.0 0.0 1.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w0</FOR>
	<GIVEN>w1</GIVEN>
	<GIVEN>w2</GIVEN>
	<GIVEN>s2_st</GIVEN>
	<GIVEN>s2_pos</GIVEN>
	<TABLE>1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 0.8 0.2 0.8 0.2 0.4 0.6 0.4 0.6 0.0 1.0 0.0 1.0 1.0 0.0 0.0 1.0 0.0 1.0 1.0 0.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 1.0 0.0 1.0 0.0 0.0 1.0 0.4 0.6 0.4 0.6 0.2 0.8 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s2_st</FOR>
	<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s2_pos</FOR>
	<TABLE>0.5 0.5</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>l1_lit</FOR>
	<GIVEN>w0</GIVEN>
	<GIVEN>l1_st</GIVEN>
	<TABLE>1.0 0.0 0.7 0.3 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>w4</FOR>
	<GIVEN>w3</GIVEN>
	<GIVEN>s3_pos</GIVEN>
	<GIVEN>s3_st</GIVEN>
	<TABLE>1.0 0.0 0.0 1.0 0.4 0.6 0.2 0.8 0.0 1.0 0.0 1.0 1.0 0.0 0.4 0.6 0.2 0.8 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s3_pos</FOR>
	<TABLE>0.8 0.2</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>s3_st</FOR>
	<TABLE>0.9 0.01 0.04 0.03 0.02</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>l2_lit</FOR>
	<GIVEN>w4</GIVEN>
	<GIVEN>l2_st</GIVEN>
	<TABLE>1.0 0.0 0.6 0.4 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>l2_st</FOR>
	<TABLE>0.9 0.03 0.07</TABLE>
</DEFINITION>

<DEFINITION>
	<FOR>l1_st</FOR>
	<TABLE>0.9 0.07 0.03</TABLE>
</DEFINITION>
</NETWORK>
</BIF>
`;